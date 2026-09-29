package org.vetta.android.domain.work

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class NotificationRulesTest {
    private val asks = SessionAlert.NeedsYou("s1", "t")
    private val done = SessionAlert.Finished("s1", "t")
    private val failed = SessionAlert.Failed("s1", "t")
    private val noon = 12 * 60

    @Test
    fun everythingArrivesByDefault() {
        listOf(asks, done, failed).forEach { assertEquals(Delivery.Alert, NotificationRules.delivery(it, "/code/app", NotificationPrefs(), noon)) }
    }

    @Test
    fun kindsAndProjectsTurnedOffStayQuiet() {
        val prefs = NotificationPrefs(finished = false, mutedProjects = setOf("/code/noisy"))
        assertEquals(Delivery.Skip, NotificationRules.delivery(done, "/code/app", prefs, noon))
        assertEquals(Delivery.Alert, NotificationRules.delivery(asks, "/code/app", prefs, noon))
        assertEquals(Delivery.Skip, NotificationRules.delivery(asks, "/code/noisy", prefs, noon), "a muted project, whatever the news")
        assertEquals(Delivery.Alert, NotificationRules.delivery(failed, null, prefs, noon), "a session of no known project")
    }

    @Test
    fun quietHoursArriveSilentlyAcrossMidnight() {
        val prefs = NotificationPrefs(quietHours = QuietHours(startMinute = 22 * 60, endMinute = 8 * 60))
        assertEquals(Delivery.Silent, NotificationRules.delivery(asks, null, prefs, 23 * 60))
        assertEquals(Delivery.Silent, NotificationRules.delivery(asks, null, prefs, 7 * 60 + 59))
        assertEquals(Delivery.Alert, NotificationRules.delivery(asks, null, prefs, 8 * 60), "the end is not inside")
        assertEquals(Delivery.Alert, NotificationRules.delivery(asks, null, prefs, noon))
        assertEquals(Delivery.Skip, NotificationRules.delivery(done, null, prefs.copy(finished = false), 23 * 60), "turned off beats quiet")
    }

    @Test
    fun quietHoursWithinOneDayAndAnEmptySpan() {
        val lunch = QuietHours(startMinute = 12 * 60, endMinute = 13 * 60)
        assertTrue(noon in lunch)
        assertFalse(13 * 60 in lunch)
        assertFalse(noon in QuietHours(startMinute = noon, endMinute = noon), "a span that starts where it ends is empty")
    }
}
