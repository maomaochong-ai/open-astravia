package org.vetta.android.ui.work

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged

/** How far a picture or page is zoomed in, and where it has been moved to. */
@Stable
class ZoomState(val maxScale: Float = 5f) {
    var scale by mutableFloatStateOf(1f)
        private set
    var offset by mutableStateOf(Offset.Zero)
        private set

    /**
     * Zooms by `zoom` about `centroid` and moves by `pan`, both in the view's own
     * coordinates, keeping the content over the view. `size` is the view's.
     */
    fun transform(zoom: Float, centroid: Offset, pan: Offset, size: Size) {
        val next = (scale * zoom).coerceIn(1f, maxScale)
        val applied = next / scale
        val center = Offset(size.width / 2, size.height / 2)
        val moved = (centroid - center) * (1 - applied) + offset * applied + pan
        scale = next
        offset = if (next == 1f) Offset.Zero else clamp(moved, size)
    }

    /** A double tap: in to 2.5× about the tap, or back out. */
    fun toggle(at: Offset, size: Size) {
        if (scale > 1f) reset() else transform(2.5f, at, Offset.Zero, size)
    }

    fun reset() {
        scale = 1f
        offset = Offset.Zero
    }

    private fun clamp(offset: Offset, size: Size): Offset {
        val maxX = (scale - 1) * size.width / 2
        val maxY = (scale - 1) * size.height / 2
        return Offset(offset.x.coerceIn(-maxX, maxX), offset.y.coerceIn(-maxY, maxY))
    }
}

/** Pinch to zoom, drag to move once zoomed, double tap to zoom in or out: a single picture. */
fun Modifier.zoomable(state: ZoomState): Modifier =
    this
        .pointerInput(state) {
            detectTapGestures(onDoubleTap = { state.toggle(it, Size(size.width.toFloat(), size.height.toFloat())) })
        }
        .pointerInput(state) {
            awaitEachGesture {
                awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                do {
                    val event = awaitPointerEvent(PointerEventPass.Initial)
                    if (event.changes.count { it.pressed } >= 2 || state.scale > 1f) {
                        val view = Size(size.width.toFloat(), size.height.toFloat())
                        state.transform(event.calculateZoom(), event.calculateCentroid(useCurrent = true), event.calculatePan(), view)
                        event.changes.forEach { if (it.positionChanged()) it.consume() }
                    }
                } while (event.changes.any { it.pressed })
            }
        }
        .graphicsLayer {
            scaleX = state.scale
            scaleY = state.scale
            translationX = state.offset.x
            translationY = state.offset.y
        }

/**
 * Two-finger pinches only, reported as a zoom factor about a point; one finger passes
 * through to whatever scrolls. For content that zooms by laying itself out larger.
 */
fun Modifier.onPinch(onZoom: (zoom: Float, centroid: Offset) -> Unit): Modifier =
    pointerInput(onZoom) {
        awaitEachGesture {
            awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
            do {
                val event = awaitPointerEvent(PointerEventPass.Initial)
                if (event.changes.count { it.pressed } >= 2) {
                    onZoom(event.calculateZoom(), event.calculateCentroid(useCurrent = true))
                    event.changes.forEach { if (it.positionChanged()) it.consume() }
                }
            } while (event.changes.any { it.pressed })
        }
    }
