package org.vetta.android.domain.work

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class LaunchTargetTest {
    @Test
    fun eachShortcutActionOpensItsPlace() {
        LaunchTarget.entries.forEach { assertEquals(it, LaunchTarget.fromAction(it.action)) }
        assertEquals(3, LaunchTarget.entries.map { it.action }.toSet().size, "every place has its own action")
    }

    @Test
    fun anOrdinaryLaunchOpensNothingInParticular() {
        assertNull(LaunchTarget.fromAction("android.intent.action.MAIN"))
        assertNull(LaunchTarget.fromAction(null))
    }
}
