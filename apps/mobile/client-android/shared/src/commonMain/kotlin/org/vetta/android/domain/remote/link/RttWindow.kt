package org.vetta.android.domain.remote.link

/**
 * The last few measured round trips. Their median is what is shown, so one sample slowed
 * by a hiccup neither makes the figure jump nor hides a lasting change for long.
 */
internal class RttWindow(private val size: Int = 5) {
    private val samples = ArrayDeque<Long>()

    /** Adds a round trip and returns the median of the window. */
    fun add(ms: Long): Long {
        samples.addLast(ms)
        if (samples.size > size) samples.removeFirst()
        val sorted = samples.sorted()
        return sorted[sorted.size / 2]
    }

    fun clear() = samples.clear()
}
