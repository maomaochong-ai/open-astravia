package org.vetta.android.domain.work

import org.vetta.android.domain.remote.RemoteSessionSummary

/**
 * What the task board overviews: work still open on the computer, newest first in each
 * part. Older sessions stay in Home's list. A stopped session is "just stopped" only
 * inside [TaskBoard.STOPPED_WINDOW_MS]; the list protocol does not say whether it
 * finished or failed, so this does not try to.
 */
data class WorkOverview(
    val waiting: List<RemoteSessionSummary>,
    val running: List<RemoteSessionSummary>,
    val stopped: List<RemoteSessionSummary>,
) {
    /** Nothing is waiting, running, or recently stopped. */
    val clear: Boolean
        get() = waiting.isEmpty() && running.isEmpty() && stopped.isEmpty()

    /** The rows under the new-session greeting: waiting first, then whatever is still running. */
    fun glance(limit: Int = TaskBoard.GLANCE_LIMIT): List<RemoteSessionSummary> = (waiting + running).take(limit)
}

object TaskBoard {
    /** Stopped sessions the overview keeps. The rest of that day stays in Home's list. */
    const val STOPPED_LIMIT = 5

    /** How recently a session must have updated to count as just stopped. */
    const val STOPPED_WINDOW_MS = 24L * 60L * 60L * 1000L

    /** How many open sessions the new-session page shows before the full board. */
    const val GLANCE_LIMIT = 2

    /**
     * Splits [sessions] at [now]. Waiting and running are kept whole; stopped sessions
     * outside the window, or with no update time, are left out.
     */
    fun overview(sessions: List<RemoteSessionSummary>, now: Long): WorkOverview {
        val newestFirst = sessions.sortedWith(compareByDescending<RemoteSessionSummary> { it.updatedAt }.thenBy { it.id })
        return WorkOverview(
            waiting = newestFirst.filter { SessionStatusGroup.of(it.status) == SessionStatusGroup.Waiting },
            running = newestFirst.filter { SessionStatusGroup.of(it.status) == SessionStatusGroup.Processing },
            stopped =
                newestFirst
                    .filter { SessionStatusGroup.of(it.status) == SessionStatusGroup.Done }
                    .filter { it.updatedAt > 0 && now - it.updatedAt <= STOPPED_WINDOW_MS }
                    .take(STOPPED_LIMIT),
        )
    }
}
