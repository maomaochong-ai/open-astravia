package org.vetta.android.domain.work

import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.RemoteSessionSummary
import org.vetta.android.domain.remote.link.LinkSnapshot
import org.vetta.android.domain.remote.link.LinkStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WidgetSummaryTest {
    private fun session(id: String, status: RemoteSessionStatus) = RemoteSessionSummary(id, "/conv", "对话", id, null, 1, status, false)

    private val sessions =
        listOf(
            session("a", RemoteSessionStatus.WaitingInput),
            session("b", RemoteSessionStatus.Running),
            session("c", RemoteSessionStatus.Thinking),
            session("d", RemoteSessionStatus.Completed),
        )

    @Test
    fun countsWhatWaitsAndWhatIsAtWork() {
        val online = MirrorState(paired = true, sessions = sessions, link = LinkSnapshot(LinkStatus.Online, peerOnline = true))
        assertEquals(WidgetSummary(WidgetSummary.State.Online, waiting = 1, working = 2), WidgetSummary.of(online))
    }

    @Test
    fun keepsTheLastCountsWhileOfflineAndInvitesPairingWithoutAComputer() {
        assertEquals(WidgetSummary(WidgetSummary.State.Offline, waiting = 1, working = 2), WidgetSummary.of(MirrorState(paired = true, sessions = sessions)))
        assertEquals(WidgetSummary(WidgetSummary.State.Unpaired), WidgetSummary.of(MirrorState(sessions = sessions)))
        assertTrue(WidgetSummary.of(MirrorState()).idle)
    }

    @Test
    fun saysSinceWhenOnlyWhileOffline() {
        val offline = MirrorState(paired = true, sessions = sessions)
        assertEquals(1_000L, WidgetSummary.of(offline, lastOnline = 1_000).lastSeenAt)
        val online = offline.copy(link = LinkSnapshot(LinkStatus.Online, peerOnline = true))
        assertNull(WidgetSummary.of(online, lastOnline = 2_000).lastSeenAt, "an online widget does not change with every event")
    }
}
