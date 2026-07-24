package com.tabakpp.app.data

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import platform.Network.NWPath
import platform.Network.NWPathMonitor
import platform.Network.NWPathStatus
import platform.darwin.dispatch_queue_create

/**
 * iOS reachability via NWPathMonitor (parity with AndroidNetworkObserver).
 */
@OptIn(ExperimentalForeignApi::class)
class IosNetworkObserver : NetworkObserver {
    private val _isOnline = MutableStateFlow(true)
    override val isOnline: StateFlow<Boolean> = _isOnline.asStateFlow()

    private val monitor = NWPathMonitor()
    private val queue = dispatch_queue_create("com.tabakpp.network", null)

    init {
        monitor.pathUpdateHandler = { path: NWPath ->
            _isOnline.value = path.status == NWPathStatus.Satisfied
        }
        monitor.start(queue)
    }
}
