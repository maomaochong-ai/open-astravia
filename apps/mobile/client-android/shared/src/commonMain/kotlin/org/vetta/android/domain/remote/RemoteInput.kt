package org.vetta.android.domain.remote

import kotlin.math.max
import kotlin.math.min

/** A key to press on the desktop, with Shift held around it for a capital. */
data class RemoteKeyStroke(val code: String, val shift: Boolean = false)

/** One piece of what was typed on the phone, as the desktop receives it. */
sealed interface RemoteTyping {
    /** A key pressed by its position on a US layout, which every desktop version understands. */
    data class Key(val stroke: RemoteKeyStroke) : RemoteTyping

    /** Text typed as-is (punctuation, Chinese, emoji), for desktops that accept typed text. */
    data class Text(val text: String) : RemoteTyping
}

/**
 * Typed text as what the desktop is sent. Letters, digits, space, Tab and Enter go as key
 * presses, so they work on any desktop; everything else printable goes as runs of text.
 * Other control characters are left out: the desktop would read them as keys the phone
 * never showed.
 */
object RemoteKeys {
    /** The most text one message carries, the desktop's own limit. */
    const val MAX_TEXT = 256

    fun typing(text: String): List<RemoteTyping> {
        val out = mutableListOf<RemoteTyping>()
        val run = StringBuilder()
        fun flush() {
            if (run.isNotEmpty()) out += RemoteTyping.Text(run.toString())
            run.clear()
        }
        for (char in text) {
            val key = key(char)
            when {
                key != null -> {
                    flush()
                    out += RemoteTyping.Key(key)
                }
                char.isISOControl() -> Unit
                else -> {
                    // Never split a surrogate pair across two messages.
                    if (run.length >= MAX_TEXT - 1 && !char.isLowSurrogate()) flush()
                    run.append(char)
                }
            }
        }
        flush()
        return out
    }

    private fun key(char: Char): RemoteKeyStroke? =
        when (char) {
            in 'a'..'z' -> RemoteKeyStroke("Key${char.uppercaseChar()}")
            in 'A'..'Z' -> RemoteKeyStroke("Key$char", shift = true)
            in '0'..'9' -> RemoteKeyStroke("Digit$char")
            ' ' -> RemoteKeyStroke("Space")
            '\t' -> RemoteKeyStroke("Tab")
            '\n' -> RemoteKeyStroke("Enter")
            else -> null
        }
}

/**
 * The desktop's picture as the phone shows it: zoomed in by a pinch (1x to [MAX_ZOOM])
 * about the view's centre and panned, never so far that the view shows past the picture's
 * edge. Maps a touch on the view back to where it lands on the desktop.
 */
data class RemoteViewport(val zoom: Float = 1f, val panX: Float = 0f, val panY: Float = 0f) {
    val zoomed: Boolean
        get() = zoom > 1.01f

    /**
     * Zooms by `factor` about `focus` (the fingers' midpoint on the view) and moves by the
     * fingers' travel, keeping the desktop point under the fingers under them.
     */
    fun transformed(factor: Float, focusX: Float, focusY: Float, moveX: Float, moveY: Float, width: Float, height: Float): RemoteViewport {
        val next = (zoom * factor).coerceIn(1f, MAX_ZOOM)
        val cx = width / 2
        val cy = height / 2
        // The picture point under the fingers before, placed back under them after.
        val px = cx + (focusX - cx - panX) / zoom
        val py = cy + (focusY - cy - panY) / zoom
        val x = focusX - cx - (px - cx) * next + moveX
        val y = focusY - cy - (py - cy) * next + moveY
        return RemoteViewport(next, clampPan(x, width, next), clampPan(y, height, next))
    }

    /** Where a point on the view lands on the desktop, from 0 to 1 across each side. */
    fun toDesktop(x: Float, y: Float, width: Float, height: Float): Pair<Float, Float> {
        if (width <= 0f || height <= 0f) return 0.5f to 0.5f
        val px = width / 2 + (x - width / 2 - panX) / zoom
        val py = height / 2 + (y - height / 2 - panY) / zoom
        return (px / width).coerceIn(0f, 1f) to (py / height).coerceIn(0f, 1f)
    }

    private fun clampPan(value: Float, side: Float, zoom: Float): Float {
        val limit = (zoom - 1f) * side / 2
        // Plus zero turns a -0 into 0, so an unmoved view equals the default.
        return max(-limit, min(limit, value)) + 0f
    }

    companion object {
        const val MAX_ZOOM = 4f
    }
}

/**
 * Two fingers' vertical travel as mouse-wheel notches: one notch per `step` pixels,
 * the remainder carried to the next move. Fingers moving down scroll the page back up,
 * as a touch screen does, which is a positive wheel delta.
 */
class WheelNotches(private val step: Float) {
    private var carried = 0f

    fun add(travel: Float): Int {
        carried += travel
        val notches = (carried / step).toInt()
        carried -= notches * step
        return notches
    }

    fun reset() {
        carried = 0f
    }

    companion object {
        /** A wheel notch in the desktop's units (Windows' WHEEL_DELTA). */
        const val WHEEL_DELTA = 120
    }
}
