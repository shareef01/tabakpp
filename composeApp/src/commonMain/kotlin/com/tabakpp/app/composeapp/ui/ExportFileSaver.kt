package com.tabakpp.app.composeapp.ui

import androidx.compose.runtime.Composable

/**
 * Platform-specific export file saver.
 *
 * Android: uses Storage Access Framework (ACTION_CREATE_DOCUMENT) to let the
 * user pick a destination, then writes UTF-8 content to the returned URI.
 * No filesystem permissions are requested.
 *
 * iOS: not yet implemented (iOS is not a target platform for this milestone).
 *
 * [onSaved] is called with (success, error) after the save flow completes.
 */
@Composable
expect fun rememberExportFileSaver(
    onSaved: (success: Boolean, error: String?) -> Unit
): ExportFileSaver

/**
 * Holds the platform save operation. Call [save] to launch the save flow.
 * [isSaving] is true while the file dialog or I/O is in progress.
 */
interface ExportFileSaver {
    val isSaving: Boolean
    fun save(content: String, filename: String, mimeType: String)
}
