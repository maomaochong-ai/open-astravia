package org.vetta.android.domain.work

import kotlin.math.max
import kotlin.math.min

/**
 * Plays a streamed reply out at an even pace with a soft fading edge (port of the iOS
 * `StreamReveal.swift`): deltas arrive from the desktop in bursts, so the text is shown
 * character by character at a steady rate that speeds up to catch up with a large burst,
 * and every newly shown character fades in instead of popping. Times are in seconds on
 * any monotonic clock.
 *
 * Starts with `shown` characters already on screen, at `time`.
 */
class StreamReveal(shown: Int, time: Double) {
    /** Characters shown so far, fractional between frames. */
    private var head: Double = shown.toDouble()

    /** Characters before this index are fully opaque. */
    private var settled: Int = shown

    /** When each still-fading character appeared, starting at [settled]. */
    private val stamps = ArrayDeque<Double>()
    private var now: Double = time

    /** Characters to lay out. */
    val shown: Int
        get() = head.toInt()

    /** Whether frames are still needed to reach `target` characters and finish fading. */
    fun animating(target: Int): Boolean = shown != target || stamps.isNotEmpty()

    /** Moves to `time`, revealing towards `target` characters. */
    fun advance(time: Double, target: Int) {
        val from = now
        val step = max(0.0, time - from)
        now = max(now, time)
        if (target < shown) {
            // The text was replaced by a shorter one (a refetch); show it as it is.
            head = target.toDouble()
            settled = min(settled, target)
            while (stamps.size > max(0, target - settled)) stamps.removeLast()
        }
        val backlog = target - head
        if (backlog > 0 && step > 0) {
            val rate = max(MINIMUM_RATE, backlog / CATCH_UP)
            val next = min(target.toDouble(), head + rate * step)
            // Each character crossed in this step appears at the moment the head passed it.
            for (index in shown until next.toInt()) {
                stamps.addLast(from + max(0.0, index + 1 - head) / rate)
            }
            head = next
        }
        while (stamps.isNotEmpty() && now - stamps.first() >= FADE) {
            stamps.removeFirst()
            settled += 1
        }
    }

    /** Opacity of the character at `index`, eased so the edge reads as a soft gradient. */
    fun opacity(index: Int): Float {
        if (index < settled) return 1f
        if (index >= shown || index - settled >= stamps.size) return 0f
        val progress = ((now - stamps[index - settled]) / FADE).coerceIn(0.0, 1.0)
        return (progress * progress * (3 - 2 * progress)).toFloat()
    }

    companion object {
        /** Characters per second when little is waiting. */
        const val MINIMUM_RATE = 45.0

        /** Whatever is waiting is shown within about this long, so the reply never lags far behind. */
        const val CATCH_UP = 0.45

        /** How long one character takes to fade in. */
        const val FADE = 0.32
    }
}
