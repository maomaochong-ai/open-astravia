package org.vetta.android.ui.work

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.ceil
import kotlin.math.roundToInt

/** An open PDF. The system renderer draws one page at a time, so drawing is taken in turn. */
private class PdfDocument(file: File) {
    private val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    private val renderer = PdfRenderer(descriptor)
    private val lock = Mutex()

    /** Width over height of each page. */
    val ratios: List<Float> =
        (0 until renderer.pageCount).map { index ->
            renderer.openPage(index).use { page -> page.width.toFloat() / page.height.coerceAtLeast(1) }
        }

    suspend fun render(index: Int, width: Int): ImageBitmap =
        lock.withLock {
            withContext(Dispatchers.IO) {
                renderer.openPage(index).use { page ->
                    val height = (width / ratios[index]).roundToInt().coerceAtLeast(1)
                    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                    bitmap.eraseColor(android.graphics.Color.WHITE)
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    bitmap.asImageBitmap()
                }
            }
        }

    fun close() {
        runCatching { renderer.close() }
        runCatching { descriptor.close() }
    }
}

@Composable
actual fun PdfPreview(name: String, data: ByteArray, modifier: Modifier, onUnreadable: () -> Unit) {
    val context = LocalContext.current
    // Null while opening; a failure (a password, a damaged file) is handed back once.
    val opened by produceState<Result<PdfDocument>?>(null, data) {
        value =
            runCatching {
                val file = PreviewFiles.write(context, name, "application/pdf", data)
                withContext(Dispatchers.IO) { PdfDocument(file) }
            }
    }
    val result = opened ?: return Loading()
    val document = result.getOrNull()
    if (document == null) {
        LaunchedEffect(result) { onUnreadable() }
        return
    }
    DisposableEffect(document) { onDispose { document.close() } }
    Pages(document, modifier)
}

@Composable
private fun Pages(document: PdfDocument, modifier: Modifier) {
    var scale by remember { mutableFloatStateOf(1f) }
    val sideways = rememberScrollState()
    val list = rememberLazyListState()
    val pinch =
        remember {
            { zoom: Float, centroid: Offset ->
                val next = (scale * zoom).coerceIn(1f, 4f)
                // Keep the spot between the fingers where it was, sideways.
                val shift = (sideways.value + centroid.x) * (next / scale - 1)
                scale = next
                sideways.dispatchRawDelta(shift)
                Unit
            }
        }
    BoxWithConstraints(modifier.testTag("files.pdf")) {
        val density = LocalDensity.current
        val baseWidth = maxWidth
        // Pages are drawn at up to twice the screen's width, sharp enough for moderate zoom without huge bitmaps.
        val pixels = with(density) { (baseWidth.toPx() * ceil(scale).coerceAtMost(2f)).roundToInt() }.coerceIn(1, 2400)
        Box(Modifier.fillMaxSize().onPinch(pinch).horizontalScroll(sideways)) {
            LazyColumn(
                state = list,
                modifier = Modifier.width(baseWidth * scale).fillMaxHeight(),
                contentPadding = PaddingValues(vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(document.ratios.size) { index ->
                    val page by produceState<ImageBitmap?>(null, index, pixels) { value = document.render(index, pixels) }
                    Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp).aspectRatio(document.ratios[index]).background(Color.White)) {
                        page?.let { Image(it, contentDescription = null, modifier = Modifier.fillMaxSize()) }
                    }
                }
            }
        }
        Text(
            "${list.firstVisibleItemIndex + 1} / ${document.ratios.size}",
            style = MaterialTheme.typography.labelMedium,
            color = Color.White,
            modifier =
                Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 16.dp)
                    .background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(12.dp))
                    .padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}
