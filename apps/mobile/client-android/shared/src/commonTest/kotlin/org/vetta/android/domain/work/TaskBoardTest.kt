package org.vetta.android.domain.work

import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.RemoteSessionSummary
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TaskBoardTest {
    private val now = 10_000_000_000L

    private fun session(
        id: String,
        status: RemoteSessionStatus = RemoteSessionStatus.Completed,
        at: Long,
        cwd: String = "/$id",
    ) = RemoteSessionSummary(id, cwd, id, id, null, at, status, false)

    @Test
    fun splitsOpenWorkFromWhatJustStopped() {
        val overview =
            TaskBoard.overview(
                listOf(
                    session("old", at = now - TaskBoard.STOPPED_WINDOW_MS - 1),
                    session("untimed", at = 0),
                    session("done", at = now - 1_000),
                    session("failed", RemoteSessionStatus.Error, at = now - 2_000),
                    session("aborted", RemoteSessionStatus.Aborted, at = now - 3_000),
                    session("idle", RemoteSessionStatus.Idle, at = now - 4_000),
                    session("run", RemoteSessionStatus.Running, at = now - 500),
                    session("think", RemoteSessionStatus.Thinking, at = now - 100),
                    session("ask", RemoteSessionStatus.WaitingInput, at = now - 50),
                    session("askOlder", RemoteSessionStatus.WaitingInput, at = now - 5_000),
                ),
                now,
            )
        assertEquals(listOf("ask", "askOlder"), overview.waiting.map { it.id })
        assertEquals(listOf("think", "run"), overview.running.map { it.id })
        assertEquals(listOf("done", "failed", "aborted", "idle"), overview.stopped.map { it.id })
        assertEquals(listOf("ask", "askOlder"), overview.glance().map { it.id })
    }

    @Test
    fun glanceFillsWithRunningOnceWaitingRunsOut() {
        val overview =
            TaskBoard.overview(
                listOf(
                    session("ask", RemoteSessionStatus.WaitingInput, at = now - 10),
                    session("run", RemoteSessionStatus.Running, at = now),
                    session("other", RemoteSessionStatus.Running, at = now - 20),
                ),
                now,
            )
        assertEquals(listOf("ask", "run"), overview.glance().map { it.id })
    }

    @Test
    fun keepsTheFiveNewestStoppedSessionsInsideADay() {
        val sessions = (1..6).map { session("s$it", at = now - it * 1_000L) }
        val overview = TaskBoard.overview(sessions, now)
        assertEquals(listOf("s1", "s2", "s3", "s4", "s5"), overview.stopped.map { it.id })
        assertTrue(overview.waiting.isEmpty())
        assertTrue(overview.running.isEmpty())
    }

    @Test
    fun aSessionUpdatedExactlyADayAgoStillCounts() {
        val edge = session("edge", at = now - TaskBoard.STOPPED_WINDOW_MS)
        assertEquals(listOf("edge"), TaskBoard.overview(listOf(edge), now).stopped.map { it.id })
    }

    @Test
    fun clearWhenNothingIsOpenOrRecentlyStopped() {
        val overview = TaskBoard.overview(listOf(session("old", at = now - TaskBoard.STOPPED_WINDOW_MS - 5)), now)
        assertTrue(overview.clear)
        assertTrue(overview.glance().isEmpty())
    }

    @Test
    fun anUpdateInTheFutureStillCountsAsJustStopped() {
        val ahead = session("ahead", at = now + 5_000)
        assertEquals(listOf("ahead"), TaskBoard.overview(listOf(ahead), now).stopped.map { it.id })
    }
}
