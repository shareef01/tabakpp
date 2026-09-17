package com.tabakpp.app.composeapp.ui

import android.content.ContentResolver
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import java.io.IOException

/**
 * Android implementation: Storage Access Framework via CreateDocument.
 *
 * - Launches ACTION_CREATE_DOCUMENT with suggested filename + MIME type
 * - User picks destination → system returns a content URI
 * - App writes UTF-8 content to the URI via ContentResolver
 * - No filesystem permissions requested
 *
 * Uses separate launchers for JSON and CSV because CreateDocument bakes the
 * MIME type into the contract at construction time.
 */
@Composable
actual fun rememberExportFileSaver(
    onSaved: (success: Boolean, error: String?) -> Unit
): ExportFileSaver {
    val context = LocalContext.current
    val contentResolver = context.contentResolver
    val onSavedUpdated by rememberUpdatedState(onSaved)

    val isSavingState = remember { mutableStateOf(false) }
    val pendingContent = remember { mutableStateOf<String?>(null) }

    val jsonLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/json")
    ) { uri: Uri? ->
        handleUriResult(uri, pendingContent.value, contentResolver, isSavingState) { s, e ->
            pendingContent.value = null
            onSavedUpdated(s, e)
        }
    }

    val csvLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("text/csv")
    ) { uri: Uri? ->
        handleUriResult(uri, pendingContent.value, contentResolver, isSavingState) { s, e ->
            pendingContent.value = null
            onSavedUpdated(s, e)
        }
    }

    return remember(jsonLauncher, csvLauncher) {
        object : ExportFileSaver {
            override val isSaving: Boolean get() = isSavingState.value

            override fun save(content: String, filename: String, mimeType: String) {
                pendingContent.value = content
                isSavingState.value = true
                when (mimeType) {
                    "application/json" -> jsonLauncher.launch(filename)
                    "text/csv" -> csvLauncher.launch(filename)
                    else -> jsonLauncher.launch(filename)
                }
            }
        }
    }
}

private fun handleUriResult(
    uri: Uri?,
    content: String?,
    contentResolver: ContentResolver,
    isSavingState: MutableState<Boolean>,
    onSaved: (Boolean, String?) -> Unit
) {
    if (uri == null) {
        isSavingState.value = false
        onSaved(false, null)
        return
    }
    if (content == null) {
        isSavingState.value = false
        onSaved(false, "No content to save")
        return
    }
    try {
        writeContentToUri(contentResolver, uri, content)
        onSaved(true, null)
    } catch (e: IOException) {
        onSaved(false, e.message ?: "Failed to save file")
    } catch (e: Exception) {
        onSaved(false, e.message ?: "Failed to save file")
    } finally {
        isSavingState.value = false
    }
}

private fun writeContentToUri(
    contentResolver: ContentResolver,
    uri: Uri,
    content: String
) {
    contentResolver.openOutputStream(uri)?.use { output ->
        output.write(content.toByteArray(Charsets.UTF_8))
        output.flush()
    } ?: throw IOException("Could not open output stream for $uri")
}
