package org.vetta.android.domain.work

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class StreamRevealTest {
    @Test
    fun revealsASmallDeltaAtTheSteadyRate() {
        val reveal = StreamReveal(shown = 0, time = 0.0)
        reveal.advance(0.1, target = 10)
        // 45 characters a second, and 10 waiting is little: about 4 after 0.1s.
        assertEquals(4, reveal.shown)
        reveal.advance(1.0, target = 10)
        assertEquals(10, reveal.shown)
    }

    @Test
    fun catchesUpWithABurstWithinTheCatchUpTime() {
        val reveal = StreamReveal(shown = 0, time = 0.0)
        var time = 0.0
        while (time < StreamReveal.CATCH_UP * 3) {
            time += 1.0 / 60
            reveal.advance(time, target = 900)
        }
        // Exponential catch-up: well past 90% of a large burst within a few catch-up periods.
        assertTrue(reveal.shown > 850)
    }

    @Test
    fun newCharactersFadeInAndSettle() {
        val reveal = StreamReveal(shown = 0, time = 0.0)
        reveal.advance(0.05, target = 2)
        assertEquals(2, reveal.shown)
        val fresh = reveal.opacity(1)
        assertTrue(fresh > 0f && fresh < 1f)
        assertTrue(reveal.opacity(0) >= fresh)
        assertEquals(0f, reveal.opacity(2))
        assertTrue(reveal.animating(2))
        reveal.advance(1.0, target = 2)
        assertEquals(1f, reveal.opacity(1))
        assertFalse(reveal.animating(2))
    }

    @Test
    fun textAlreadyOnScreenIsOpaque() {
        val reveal = StreamReveal(shown = 120, time = 5.0)
        assertEquals(1f, reveal.opacity(119))
        assertFalse(reveal.animating(120))
    }

    @Test
    fun aShorterRefetchIsShownAsItIs() {
        val reveal = StreamReveal(shown = 0, time = 0.0)
        reveal.advance(0.5, target = 40)
        reveal.advance(0.52, target = 5)
        assertEquals(5, reveal.shown)
        reveal.advance(2.0, target = 5)
        assertEquals(1f, reveal.opacity(4))
        assertFalse(reveal.animating(5))
    }
}
