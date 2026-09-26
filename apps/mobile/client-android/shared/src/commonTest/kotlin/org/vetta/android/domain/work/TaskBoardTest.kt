package org.vetta.android.domain.work

import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.RemoteSessionSummary
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TaskBoardTest {
    private fun session(id: String, status: RemoteSessionStatus = RemoteSessionStatus.Completed, cwd: String, at: Long) =
        RemoteSessionSummary(id, cwd, cwd.drop(1), id, null, at, status, false)

    @Test
    fun ranksWaitingThenRunningThenConversationsThenDone() {
        val sessions =
            listOf(
                session("done", cwd = "/done", at = 90),
                session("run", RemoteSessionStatus.Running, cwd = "/run", at = 10),
                session("chat", cwd = "/conv", at = 1),
                session("wait", RemoteSessionStatus.WaitingInput, cwd = "/wait", at = 5),
            )
        val cards = TaskBoard.cards(sessions, conversationCwd = "/conv")
        assertEquals(listOf("/wait", "/run", "/conv", "/done"), cards.map { it.cwd })
        assertEquals(listOf(100, 10, 5, 1), cards.map { it.score })
    }

    @Test
    fun scoresAddUpSoWaitingAndRunningOutranksWaitingAlone() {
        val sessions =
            listOf(
                session("w1", RemoteSessionStatus.WaitingInput, cwd = "/a", at = 50),
                session("w2", RemoteSessionStatus.WaitingInput, cwd = "/b", at = 1),
                session("r2", RemoteSessionStatus.Thinking, cwd = "/b", at = 2),
            )
        val cards = TaskBoard.cards(sessions, conversationCwd = "/conv")
        assertEquals(listOf("/b", "/a"), cards.map { it.cwd })
        assertEquals(110, cards[0].score)
    }

    @Test
    fun conversationsFollowTheirSessionsAndLeadTheirTier() {
        val sessions =
            listOf(
                session("w", RemoteSessionStatus.WaitingInput, cwd = "/a", at = 99),
                session("chat", RemoteSessionStatus.WaitingInput, cwd = "/conv", at = 1),
            )
        val cards = TaskBoard.cards(sessions, conversationCwd = "/conv")
        assertEquals(listOf("/conv", "/a"), cards.map { it.cwd })
        assertEquals(105, cards[0].score)
        assertTrue(cards[0].isConversation)
    }

    @Test
    fun sameScoreGoesMostRecentFirst() {
        val sessions = listOf(session("old", cwd = "/old", at = 1), session("new", cwd = "/new", at = 2))
        assertEquals(listOf("/new", "/old"), TaskBoard.cards(sessions, conversationCwd = "/conv").map { it.cwd })
    }

    @Test
    fun activeCardListsWaitingThenRunningThenFillsUpWithTheNewestOthers() {
        val sessions =
            listOf(
                session("done", cwd = "/a", at = 100),
                session("run", RemoteSessionStatus.Running, cwd = "/a", at = 50),
                session("wait", RemoteSessionStatus.WaitingInput, cwd = "/a", at = 10),
                session("error", RemoteSessionStatus.Error, cwd = "/a", at = 60),
                session("old", cwd = "/a", at = 1),
            )
        val card = TaskBoard.cards(sessions, conversationCwd = "/conv")[0]
        assertEquals(listOf("wait", "run", "done"), card.sessions.map { it.id })
        assertEquals(1, card.waiting)
        assertEquals(1, card.running)
        assertEquals(100, card.updatedAt)
    }

    @Test
    fun doneCardListsItsNewestThreeCountingErrorsAsDone() {
        val sessions = (1..5).map { session("s$it", if (it == 5) RemoteSessionStatus.Error else RemoteSessionStatus.Completed, cwd = "/a", at = it.toLong()) }
        val card = TaskBoard.cards(sessions, conversationCwd = "/conv")[0]
        assertEquals(listOf("s5", "s4", "s3"), card.sessions.map { it.id })
        assertEquals(1, card.score)
        assertEquals(0, card.hidden)
    }

    @Test
    fun capsActiveSessionsAndCountsTheRest() {
        val sessions = (1..8).map { session("r$it", RemoteSessionStatus.Running, cwd = "/a", at = it.toLong()) }
        val card = TaskBoard.cards(sessions, conversationCwd = "/conv")[0]
        assertEquals(TaskBoard.ACTIVE_LIMIT, card.sessions.size, "enough active ones leave no room for finished ones")
        assertEquals("r8", card.sessions.first().id)
        assertEquals(3, card.hidden)
    }

    @Test
    fun keepsOnlyTheNewestAllDoneProjectsButEveryActiveOne() {
        val sessions =
            (1..9).map { session("d$it", cwd = "/d$it", at = it.toLong()) } +
                session("chat", cwd = "/conv", at = 0) +
                (1..8).map { session("r$it", RemoteSessionStatus.Running, cwd = "/r$it", at = it.toLong()) }
        val cards = TaskBoard.cards(sessions, conversationCwd = "/conv")
        assertEquals(8, cards.count { it.active })
        assertTrue(cards.any { it.isConversation }, "the conversations are not a project and stay")
        assertEquals(listOf("/d9", "/d8", "/d7", "/d6", "/d5", "/d4"), cards.filter { !it.active && !it.isConversation }.map { it.cwd })
    }

    @Test
    fun showsNothingUntilTheConversationBucketIsKnown() {
        assertTrue(TaskBoard.cards(listOf(session("x", cwd = "/a", at = 1)), conversationCwd = null).isEmpty())
    }

    @Test
    fun columnsFillTheShortestFirst() {
        val sessions =
            listOf(
                session("a1", RemoteSessionStatus.Running, cwd = "/a", at = 9),
                session("a2", RemoteSessionStatus.Running, cwd = "/a", at = 8),
                session("a3", RemoteSessionStatus.Running, cwd = "/a", at = 7),
                session("b1", RemoteSessionStatus.Running, cwd = "/b", at = 6),
                session("c1", RemoteSessionStatus.Running, cwd = "/c", at = 5),
                session("d1", RemoteSessionStatus.Running, cwd = "/d", at = 4),
            )
        val columns = TaskBoard.columns(TaskBoard.cards(sessions, conversationCwd = "/conv"), count = 2)
        assertEquals(listOf(listOf("/a", "/d"), listOf("/b", "/c")), columns.map { column -> column.map { it.cwd } })
    }
}
