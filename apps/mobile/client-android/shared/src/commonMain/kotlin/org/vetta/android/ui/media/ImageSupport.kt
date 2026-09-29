package org.vetta.android.ui.media

import androidx.compose.ui.graphics.ImageBitmap

expect fun imageBitmapFromBytes(bytes: ByteArray): ImageBitmap?
