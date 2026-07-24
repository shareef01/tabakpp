package com.tabakpp.app.composeapp.ui.components

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import com.tabakpp.app.composeapp.theme.LocalSnackbarHostState
import com.tabakpp.app.composeapp.theme.TextDisabled
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private const val MAX_AVATAR_INPUT_BYTES = 20 * 1024 * 1024

@Composable
actual fun AvatarIdentityBadge(
    avatarDataUrl: String?,
    accentColor: Color,
    modifier: Modifier,
    onAvatarChanged: (String?) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbarHostState = LocalSnackbarHostState.current
    var busy by remember { mutableStateOf(false) }

    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickVisualMedia()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        busy = true
        scope.launch {
            try {
                val bytes = withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(uri)?.use { input ->
                        input.readNBytes(MAX_AVATAR_INPUT_BYTES + 1).also {
                            if (it.size > MAX_AVATAR_INPUT_BYTES) {
                                throw IllegalStateException("AVATAR_TOO_LARGE")
                            }
                        }
                    }
                } ?: throw IllegalStateException("READ_FAILED")
                val dataUrl = withContext(Dispatchers.Default) { compressAvatarBytes(bytes) }
                onAvatarChanged(dataUrl)
            } catch (e: Exception) {
                val message = when (e.message) {
                    "AVATAR_TOO_LARGE" -> "Image still too large"
                    "DECODE_FAILED", "INVALID_IMAGE" -> "Could not process image"
                    else -> "Could not process image"
                }
                snackbarHostState.showSnackbar(message)
            } finally {
                busy = false
            }
        }
    }

    val bitmap = remember(avatarDataUrl) { decodeAvatarBitmap(avatarDataUrl) }
    DisposableEffect(bitmap) {
        onDispose { bitmap?.recycle() }
    }

    Box(modifier = modifier.size(72.dp), contentAlignment = Alignment.BottomEnd) {
        Surface(
            modifier = Modifier
                .fillMaxSize()
                .clip(CircleShape)
                .clickable(enabled = !busy) {
                    launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                },
            shape = CircleShape,
            color = Color.White.copy(alpha = 0.05f),
            border = BorderStroke(1.dp, Color.White.copy(alpha = 0.08f))
        ) {
            Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                when {
                    busy -> CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = accentColor,
                        strokeWidth = 2.dp
                    )
                    bitmap != null -> Image(
                        bitmap = bitmap.asImageBitmap(),
                        contentDescription = "Avatar",
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop
                    )
                    else -> Icon(
                        Icons.Default.Person,
                        contentDescription = "Choose avatar",
                        modifier = Modifier.size(36.dp),
                        tint = TextDisabled
                    )
                }
            }
        }

        if (!busy && avatarDataUrl != null) {
            Surface(
                onClick = { onAvatarChanged(null) },
                modifier = Modifier.size(24.dp),
                shape = CircleShape,
                color = Color.Black,
                border = BorderStroke(2.dp, Color(0xFF09090B))
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = "Remove avatar",
                        modifier = Modifier.padding(4.dp).size(14.dp),
                        tint = Color.White
                    )
                }
            }
        } else if (!busy) {
            Surface(
                modifier = Modifier.size(24.dp),
                shape = CircleShape,
                color = accentColor,
                border = BorderStroke(2.dp, Color.Black)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Default.Person,
                        contentDescription = "Add avatar",
                        modifier = Modifier.padding(4.dp).size(12.dp),
                        tint = Color.Black
                    )
                }
            }
        }
    }
}

private fun decodeAvatarBitmap(dataUrl: String?): Bitmap? {
    if (dataUrl.isNullOrBlank() || !dataUrl.startsWith("data:image")) return null
    return try {
        val b64 = dataUrl.substringAfter("base64,", missingDelimiterValue = "")
        if (b64.isBlank()) return null
        val bytes = Base64.decode(b64, Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    } catch (_: Exception) {
        null
    }
}

internal fun compressAvatarBytes(
    bytes: ByteArray,
    maxSide: Int = 256,
    maxChars: Int = 90_000
): String {
    if (bytes.size > MAX_AVATAR_INPUT_BYTES) {
        throw IllegalStateException("AVATAR_TOO_LARGE")
    }
    val original = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        ?: throw IllegalStateException("DECODE_FAILED")
    var scaled: Bitmap? = null
    try {
        val scale = min(1f, maxSide.toFloat() / max(original.width, original.height))
        val w = max(1, (original.width * scale).roundToInt())
        val h = max(1, (original.height * scale).roundToInt())
        scaled = if (w == original.width && h == original.height) {
            original
        } else {
            Bitmap.createScaledBitmap(original, w, h, true)
        }
        val outputBitmap = scaled ?: throw IllegalStateException("DECODE_FAILED")

        var quality = 72
        var jpeg: ByteArray
        do {
            jpeg = java.io.ByteArrayOutputStream().use { stream ->
                outputBitmap.compress(Bitmap.CompressFormat.JPEG, quality, stream)
                stream.toByteArray()
            }
            quality -= 10
        } while (jpeg.size * 4 / 3 > maxChars && quality >= 35)

        val dataUrl = "data:image/jpeg;base64," + Base64.encodeToString(jpeg, Base64.NO_WRAP)
        if (dataUrl.length > maxChars) throw IllegalStateException("AVATAR_TOO_LARGE")
        return dataUrl
    } finally {
        if (scaled !== original) scaled?.recycle()
        original.recycle()
    }
}
