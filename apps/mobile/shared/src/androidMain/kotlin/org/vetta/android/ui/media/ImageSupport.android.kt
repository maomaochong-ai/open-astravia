package org.vetta.android.ui.media

import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext

actual fun imageBitmapFromBytes(bytes: ByteArray): ImageBitmap? {
    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
    return bitmap.asImageBitmap()
}

@Composable
actual fun rememberImagePicker(onPicked: (List<PickedImage>) -> Unit): () -> Unit {
    val context = LocalContext.current
    val launcher =
        rememberLauncherForActivityResult(
            contract = ActivityResultContracts.GetMultipleContents(),
        ) { uris ->
            val picked =
                uris.mapNotNull { uri ->
                    runCatching {
                        val mime = context.contentResolver.getType(uri) ?: "image/jpeg"
                        if (!mime.startsWith("image/")) return@runCatching null
                        val bytes =
                            context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                                ?: return@runCatching null
                        // 限制单图约 4MB，避免 Settings 持久化爆表
                        if (bytes.size > 4 * 1024 * 1024) return@runCatching null
                        val name = uri.lastPathSegment
                        PickedImage(mimeType = mime, fileName = name, bytes = bytes)
                    }.getOrNull()
                }
            if (picked.isNotEmpty()) {
                onPicked(picked)
            }
        }
    return remember(launcher) {
        { launcher.launch("image/*") }
    }
}
