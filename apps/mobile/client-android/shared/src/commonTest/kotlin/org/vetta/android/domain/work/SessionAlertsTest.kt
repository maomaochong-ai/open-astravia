package org.vetta.android.domain.work

import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.RemoteSessionSummary
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SessionAlertsTest {
    private fun session(id: String, status: RemoteSessionStatus, title: String = "标题 $id") =
        RemoteSessionSummary(id, "/conv", "对话", title, null, 1, status, false)

    @Test
    fun askingTheUserFinishingAndFailingAreWorthTelling() {
        val before =
            listOf(
                session("ask", RemoteSessionStatus.Running),
                session("done", RemoteSessionStatus.Thinking),
                session("fail", RemoteSessionStatus.Running),
                session("answered", RemoteSessionStatus.WaitingInput),
            )
        val after =
            listOf(
                session("ask", RemoteSessionStatus.WaitingInput),
                session("done", RemoteSessionStatus.Completed),
                session("fail", RemoteSessionStatus.Error),
                session("answered", RemoteSessionStatus.Idle),
            )
        assertEquals(
            listOf(
                SessionAlert.NeedsYou("ask", "标题 ask"),
                SessionAlert.Finished("done", "标题 done"),
                SessionAlert.Failed("fail", "标题 fail"),
                SessionAlert.Finished("answered", "标题 answered"),
            ),
            SessionAlerts.between(before, after),
        )
    }

    @Test
    fun newSessionsQuietChangesAndStartsRaiseNothing() {
        assertTrue(SessionAlerts.between(emptyList(), listOf(session("new", RemoteSessionStatus.WaitingInput))).isEmpty(), "no replay of old news on connecting")
        assertTrue(SessionAlerts.between(listOf(session("a", RemoteSessionStatus.Idle)), listOf(session("a", RemoteSessionStatus.Running))).isEmpty(), "starting to work is not news")
        assertTrue(SessionAlerts.between(listOf(session("a", RemoteSessionStatus.Idle)), listOf(session("a", RemoteSessionStatus.Completed))).isEmpty(), "nothing was running")
        assertTrue(SessionAlerts.between(listOf(session("a", RemoteSessionStatus.Running)), listOf(session("a", RemoteSessionStatus.Running, "改名"))).isEmpty())
    }

    @Test
    fun newsFromJustBeforeLeavingIsPostedOnceTheAppIsGone() {
        val waiting = session("ask", RemoteSessionStatus.WaitingInput)
        val answered = session("answered", RemoteSessionStatus.Running)
        val held =
            listOf(
                HeldAlert(SessionAlert.Finished("old", "t"), at = 0),
                HeldAlert(SessionAlert.NeedsYou("ask", "t"), at = 90_000),
                HeldAlert(SessionAlert.NeedsYou("answered", "t"), at = 95_000),
                HeldAlert(SessionAlert.Failed("done", "t"), at = 96_000),
                HeldAlert(SessionAlert.Finished("done", "t"), at = 99_000),
            )
        assertEquals(
            listOf(SessionAlert.NeedsYou("ask", "t"), SessionAlert.Finished("done", "t")),
            SessionAlerts.dueOnLeaving(held, listOf(waiting, answered), now = 100_000),
            "too old, already answered, and superseded news are left out",
        )
    }
}
