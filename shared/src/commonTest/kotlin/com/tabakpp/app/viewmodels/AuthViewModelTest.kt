package com.tabakpp.app.viewmodels

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class AuthViewModelTest {

    private lateinit var auth: FakeAuthRepository

    // Unconfined main runs viewModelScope launches eagerly to first suspension.
    // Fake repo suspend funs never really suspend, so mutation coroutines complete
    // synchronously and we can assert without advancing virtual time.
    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        auth = FakeAuthRepository()
    }

    @AfterTest
    fun tearDown() = Dispatchers.resetMain()

    private fun vm() = AuthViewModel(auth, FakeNetworkObserver())

    @Test
    fun signUp_rejectsShortPassword_withoutCallingRepository() {
        val vm = vm()
        vm.signUp("a@b.com", "short", "Alex")

        assertEquals(0, auth.signUpCallCount, "repo must not be called for a too-short password")
        assertTrue(vm.error.value!!.contains(AuthViewModel.MIN_PASSWORD_LENGTH.toString()))
        assertFalse(vm.loading.value)
    }

    @Test
    fun signUp_acceptsValidPassword_andSanitizesDisplayName() {
        val vm = vm()
        vm.signUp("a@b.com", "twelvecharssss", "  Ada<script>  ")

        assertEquals(1, auth.signUpCallCount)
        assertEquals("twelvecharssss", auth.lastSignUpPassword)
        // Display name is sanitized before hitting the repo: the '<' and '>' chars are
        // stripped (leaving the inner text) and surrounding whitespace trimmed.
        assertEquals("Adascript", auth.lastSignUpDisplayName)
        assertNull(vm.error.value)
    }

    @Test
    fun signUp_blankDisplayNameBecomesNull() {
        val vm = vm()
        vm.signUp("a@b.com", "twelvecharssss", "   ")
        assertEquals(1, auth.signUpCallCount)
        assertNull(auth.lastSignUpDisplayName)
    }

    @Test
    fun signIn_failureMapsToNonEnumeratingMessage() {
        auth.signInResult = Result.failure(Exception("USER_NOT_FOUND"))
        val vm = vm()
        vm.signIn("a@b.com", "whatever12345")

        val msg = vm.error.value!!
        assertFalse(msg.contains("USER_NOT_FOUND"), "raw backend code must not leak")
        assertFalse(vm.loading.value)
    }

    @Test
    fun resetPassword_alwaysAcknowledges_evenOnFailure() {
        auth.resetResult = Result.failure(Exception("USER_NOT_FOUND"))
        val vm = vm()
        vm.resetPassword("missing@b.com")

        assertTrue(vm.success.value != null, "reset must acknowledge regardless of account existence")
        assertNull(vm.error.value)
    }

    @Test
    fun authState_reflectsRepositoryCurrentUser() {
        auth.currentUserFlow.value = testUser(uid = "abc")
        val vm = vm()
        assertEquals("abc", vm.authState.value?.uid)
        assertTrue(vm.authReady.value)
    }

    @Test
    fun googleSignInAvailability_isPassedThrough() {
        val vmOff = AuthViewModel(FakeAuthRepository(isGoogleSignInAvailable = false), FakeNetworkObserver())
        assertFalse(vmOff.googleSignInAvailable)
    }
}
