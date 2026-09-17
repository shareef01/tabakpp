package com.tabakpp.app.composeapp.ui

/**
 * Platform clipboard helper — copies [text] to the system clipboard.
 * Android uses ClipboardManager; iOS uses UIPasteboard.
 */
expect fun copyToClipboard(context: Any, text: String, label: String)
