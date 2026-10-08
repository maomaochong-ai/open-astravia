package org.vetta.android.domain.remote.link

import kotlin.test.Test
import kotlin.test.assertEquals

class RttWindowTest {
    @Test
    fun showsTheMedianOfTheLastFiveSoOneHiccupDoesNotJump() {
        val window = RttWindow()
        assertEquals(40L, window.add(40))
        listOf(42L, 38L, 41L).forEach(window::add)
        assertEquals(41L, window.add(900), "one slow sample leaves the figure where it was")
    }

    @Test
    fun followsALastingChangeOnceItIsMostOfTheWindow() {
        val window = RttWindow()
        listOf(40L, 40L, 40L, 40L, 40L).forEach(window::add)
        window.add(300)
        window.add(300)
        assertEquals(300L, window.add(300), "three of five slow samples move it")
    }

    @Test
    fun startsOverWhenCleared() {
        val window = RttWindow()
        listOf(300L, 300L, 300L).forEach(window::add)
        window.clear()
        assertEquals(20L, window.add(20))
    }
}
