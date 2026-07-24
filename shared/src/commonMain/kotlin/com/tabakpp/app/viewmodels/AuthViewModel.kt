package com.tabakpp.app.viewmodels

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tabakpp.app.data.AuthErrorMapper
import com.tabakpp.app.data.AuthRepository
import com.tabakpp.app.data.NetworkObserver
import com.tabakpp.app.data.User
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

class AuthViewModel(
    private val authRepository: AuthRepository,
    private val networkObserver: NetworkObserver
) : ViewModel() {
    companion object {
        const val MIN_PASSWORD_LENGTH = 12
    }

    val isOnline = networkObserver.isOnline

    /** Hide Google button on platforms without an implementation (iOS stub). */
    val googleSignInAvailable: Boolean = authRepository.isGoogleSignInAvailable

    /** False until the first authStateChanged emission (avoids signed-out flash). */
    val authReady: StateFlow<Boolean> = authRepository.currentUser
        .map { true }
        .stateIn(viewModelScope, SharingStarted.Eagerly, false)

    val authState: StateFlow<User?> = authRepository.currentUser
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val _loading = MutableStateFlow(false)
    val loading = _loading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error = _error.asStateFlow()

    private val _success = MutableStateFlow<String?>(null)
    val success = _success.asStateFlow()

    fun signIn(email: String, password: String) {
        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            _success.value = null
            authRepository.signInWithEmail(email, password)
                .onFailure { _error.value = AuthErrorMapper.map(it, AuthErrorMapper.Context.LOGIN) }
            _loading.value = false
        }
    }

    fun signUp(email: String, password: String, displayName: String = "") {
        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            _success.value = null
            if (password.length < MIN_PASSWORD_LENGTH) {
                _error.value = "Use a password with at least $MIN_PASSWORD_LENGTH characters."
                _loading.value = false
                return@launch
            }
            authRepository.signUpWithEmail(
                email,
                password,
                com.tabakpp.app.data.InputSanitizer.displayName(displayName).takeIf { it.isNotBlank() }
            )
                .onFailure { _error.value = AuthErrorMapper.map(it, AuthErrorMapper.Context.REGISTER) }
            _loading.value = false
        }
    }

    fun signInWithGoogle() {
        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            _success.value = null
            authRepository.signInWithGoogle()
                .onFailure { _error.value = AuthErrorMapper.map(it, AuthErrorMapper.Context.LOGIN) }
            _loading.value = false
        }
    }

    fun resetPassword(email: String) {
        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            _success.value = null
            authRepository.sendPasswordResetEmail(email)
                .onSuccess { _success.value = AuthErrorMapper.map(null, AuthErrorMapper.Context.RESET) }
                .onFailure { _success.value = AuthErrorMapper.map(null, AuthErrorMapper.Context.RESET) }
            _loading.value = false
        }
    }

    fun signOut() {
        viewModelScope.launch {
            authRepository.signOut()
        }
    }

    fun deleteAccount(password: String? = null, onDone: (Result<Unit>) -> Unit = {}) {
        viewModelScope.launch {
            _loading.value = true
            _error.value = null
            val result = authRepository.deleteAccount(password)
            result.onFailure { _error.value = AuthErrorMapper.map(it, AuthErrorMapper.Context.DELETE) }
            _loading.value = false
            onDone(result)
        }
    }

    fun clearError() {
        _error.value = null
    }

    fun clearSuccess() {
        _success.value = null
    }
}
