package com.tabakpp.app.composeapp.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember

/**
 * iOS stub: file save is not yet implemented (iOS is not a target platform).
 * The Ready state shows a notification; full UIPasteboard integration TBD.
 */
@Composable
actual fun rememberExportFileSaver(
    onSaved: (success: Boolean, error: String?) -> Unit
): ExportFileSaver {
    return remember {
        object : ExportFileSaver {
            override val isSaving: Boolean = false
            override fun save(content: String, filename: String, mimeType: String) {
                onSaved(false, "File save is not available on this platform")
            }
        }
    }
}
