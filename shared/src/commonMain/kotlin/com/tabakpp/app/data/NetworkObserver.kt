package com.tabakpp.app.data

import kotlinx.coroutines.flow.StateFlow

interface NetworkObserver {
    val isOnline: StateFlow<Boolean>
}
