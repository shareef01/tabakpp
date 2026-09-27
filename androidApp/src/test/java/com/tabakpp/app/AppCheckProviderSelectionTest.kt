package com.tabakpp.app

import kotlin.test.Test
import kotlin.test.assertTrue
import kotlin.test.assertFalse
import java.io.File

/**
 * Verifies the source-set contract for App Check provider selection.
 *
 * The AppCheckInstaller is split across src/debug and src/release.
 * This test enforces that:
 * - The debug source set uses DebugAppCheckProviderFactory.
 * - The release source set uses PlayIntegrityAppCheckProviderFactory.
 * - The release source set NEVER references the debug provider.
 *
 * This is an architectural/source-set test: it does not require
 * Play Integrity attestation to run. It proves the structural
 * separation that the build system relies on.
 */
class AppCheckProviderSelectionTest {

    // user.dir in Gradle unit tests is the module directory (androidApp/)
    private val moduleDir: File = File(System.getProperty("user.dir")!!)

    private fun releaseInstallerSource(): String {
        val f = File(moduleDir, "src/release/java/com/tabakpp/app/AppCheckInstaller.kt")
        assertTrue(f.exists(), "release AppCheckInstaller.kt must exist at ${f.absolutePath}")
        return f.readText()
    }

    private fun debugInstallerSource(): String {
        val f = File(moduleDir, "src/debug/java/com/tabakpp/app/AppCheckInstaller.kt")
        assertTrue(f.exists(), "debug AppCheckInstaller.kt must exist at ${f.absolutePath}")
        return f.readText()
    }

    @Test
    fun releaseSourceSet_usesPlayIntegrityProvider() {
        val src = releaseInstallerSource()
        assertTrue(
            src.contains("PlayIntegrityAppCheckProviderFactory"),
            "Release AppCheckInstaller must use PlayIntegrityAppCheckProviderFactory"
        )
    }

    @Test
    fun releaseSourceSet_neverReferencesDebugProvider() {
        val src = releaseInstallerSource()
        assertTrue(
            !src.contains("DebugAppCheckProviderFactory"),
            "Release AppCheckInstaller must NOT reference DebugAppCheckProviderFactory. " +
                "If it does, a release build could fall back to the debug provider."
        )
    }

    @Test
    fun debugSourceSet_usesDebugProvider() {
        val src = debugInstallerSource()
        assertTrue(
            src.contains("DebugAppCheckProviderFactory"),
            "Debug AppCheckInstaller must use DebugAppCheckProviderFactory"
        )
    }

    @Test
    fun debugAndReleaseAreDistinctSourceSetFiles() {
        val debugFile = File(moduleDir, "src/debug/java/com/tabakpp/app/AppCheckInstaller.kt")
        val releaseFile = File(moduleDir, "src/release/java/com/tabakpp/app/AppCheckInstaller.kt")
        assertTrue(debugFile.exists(), "debug source file must exist")
        assertTrue(releaseFile.exists(), "release source file must exist")
        assertTrue(
            debugFile.absolutePath != releaseFile.absolutePath,
            "Debug and release AppCheckInstaller must be distinct source-set files"
        )
    }

    @Test
    fun tabakApp_initializesViaAppCheckInstaller_only() {
        val f = File(moduleDir, "src/main/java/com/tabakpp/app/TabakApp.kt")
        assertTrue(f.exists(), "TabakApp.kt must exist")
        val src = f.readText()
        // All App Check initialization must go through the centralized installer.
        assertTrue(
            src.contains("AppCheckInstaller.install()"),
            "TabakApp must call AppCheckInstaller.install() to centralize App Check setup"
        )
        // TabakApp must NOT directly import any provider factory — all App
        // Check initialization goes through AppCheckInstaller.install() which
        // is resolved at compile time via source-set separation.
        assertFalse(
            src.contains("import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory"),
            "TabakApp must not import DebugAppCheckProviderFactory directly"
        )
        assertFalse(
            src.contains("import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory"),
            "TabakApp must not import PlayIntegrityAppCheckProviderFactory directly"
        )
    }

    @Test
    fun buildGradle_usesDebugImplementationForDebugProvider() {
        val f = File(moduleDir, "build.gradle.kts")
        assertTrue(f.exists(), "build.gradle.kts must exist")
        val src = f.readText()
        assertTrue(
            src.contains("debugImplementation(libs.firebase.appcheck.debug)"),
            "App Check debug provider must be scoped to debugImplementation to avoid " +
                "bundling the Debug provider in release APKs"
        )
    }

    @Test
    fun buildGradle_usesReleaseImplementationForPlayIntegrity() {
        val f = File(moduleDir, "build.gradle.kts")
        assertTrue(f.exists(), "build.gradle.kts must exist")
        val src = f.readText()
        assertTrue(
            src.contains("releaseImplementation(libs.firebase.appcheck.playintegrity)"),
            "App Check Play Integrity provider must be scoped to releaseImplementation"
        )
    }

    @Test
    fun buildGradle_doesNotExposeDebugProviderToRelease() {
        val f = File(moduleDir, "build.gradle.kts")
        assertTrue(f.exists(), "build.gradle.kts must exist")
        val src = f.readText()
        // The only acceptable form is debugImplementation for the debug provider.
        // A plain `implementation(...)` would bundle the Debug provider in release.
        assertFalse(
            src.contains("implementation(libs.firebase.appcheck.debug)"),
            "firebase-appcheck-debug must NOT be a plain implementation dependency " +
                "(would bundle Debug provider in release APK)"
        )
    }

    @Test
    fun appCheckInstaller_enablesTokenAutoRefresh() {
        val releaseSrc = releaseInstallerSource()
        val debugSrc = debugInstallerSource()
        assertTrue(
            releaseSrc.contains("setTokenAutoRefreshEnabled(true)"),
            "Release AppCheckInstaller must explicitly enable token auto-refresh"
        )
        assertTrue(
            debugSrc.contains("setTokenAutoRefreshEnabled(true)"),
            "Debug AppCheckInstaller must explicitly enable token auto-refresh"
        )
    }
}