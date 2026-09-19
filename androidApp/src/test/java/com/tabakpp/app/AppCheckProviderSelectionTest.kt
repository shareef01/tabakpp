package com.tabakpp.app

import kotlin.test.Test
import kotlin.test.assertTrue
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
}