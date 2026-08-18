package org.vetta.android.ui.media

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.ImageBitmap
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

data class PickedImage(
    val mimeType: String,
    val fileName: String?,
    val bytes: ByteArray,
) {
    @OptIn(ExperimentalEncodingApi::class)
    fun toBase64(): String = Base64.encode(bytes)
}

expect fun imageBitmapFromBytes(bytes: ByteArray): ImageBitmap?

@OptIn(ExperimentalEncodingApi::class)
fun imageBitmapFromBase64(base64: String): ImageBitmap? =
    runCatching {
        imageBitmapFromBytes(Base64.decode(base64))
    }.getOrNull()

/**
 * 平台图片选择器。返回启动函数；Android 走系统相册多选。
 */
@Composable
expect fun rememberImagePicker(onPicked: (List<PickedImage>) -> Unit): () -> Unit
