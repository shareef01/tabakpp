package com.tabakpp.app.data

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Firestore does not cascade deletes: a subcollection that firestore.rules
 * defines under `users/{uid}` but `deleteAllUserData` does not wipe silently
 * survives account deletion. Parity with the web guard in
 * webApp/src/services/registryService.test.js.
 */
class AccountWipeCoverageTest {

    private fun locateRulesFile(): File {
        // Same upward walk as DomainContractFixturesTest — the test working
        // directory is normally the module root (shared/).
        var dir = File(".").absoluteFile
        repeat(6) {
            val candidate = File(dir, "firestore.rules")
            if (candidate.exists()) return candidate
            dir = dir.parentFile ?: return@repeat
        }
        fail("Could not locate firestore.rules from ${File(".").absolutePath}")
    }

    @Test
    fun wipeCoversEverySubcollectionDefinedInRules() {
        val defined = Regex("""^ {6}match /(\w+)/\{\w+\}""", RegexOption.MULTILINE)
            .findAll(locateRulesFile().readText())
            .map { it.groupValues[1] }
            .toList()
        assertTrue(defined.isNotEmpty(), "no users/{uid} subcollections found in firestore.rules")
        // AUD-016 exception: `trustedOperations` is the server-only receipt
        // namespace — clients cannot touch it (rules deny unconditionally), a
        // LEGACY account can never own any, and locked accounts (the only ones
        // that can) delete via deleteAccountData's Admin recursiveDelete, which
        // removes the whole users/{uid} subtree. Listing it in the client wipe
        // would only make the wipe fail with permission-denied. It is still
        // pinned to the rules so a rename is caught.
        assertTrue("trustedOperations" in defined, "trustedOperations must stay defined in firestore.rules")
        val clientWipeable = defined.filter { it != "trustedOperations" }
        assertEquals(clientWipeable.sorted(), USER_SUBCOLLECTIONS.sorted())
    }
}
