package com.tabakpp.app.composeapp.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context

/** Android clipboard: copies [text] to the system clipboard. */
actual fun copyToClipboard(context: Any, text: String, label: String) {
    val ctx = context as Context
    val clipboard = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    val clip = ClipData.newPlainText(label, text)
    clipboard.setPrimaryClip(clip)
}
