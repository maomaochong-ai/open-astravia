package org.vetta.android.domain.work

import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.RemoteSessionSummary

/** Something about a session worth telling the user while the app is out of sight. */
sealed interface SessionAlert {
    val sessionId: String
    val title: String

    /** The session stopped to ask the user something. */
    data class NeedsYou(override val sessionId: String, override val title: String) : SessionAlert

    /** A turn that was running came to an end. */
    data class Finished(override val sessionId: String, override val title: String) : SessionAlert

    /** A turn that was running stopped on an error. */
    data class Failed(override val sessionId: String, override val title: String) : SessionAlert
}

object SessionAlerts {
    /**
     * What changed between two session lists that deserves a notification: a session that
     * starts waiting on the user, and one whose running turn finishes or fails. A session
     * first seen, or one that only moved in the list, raises nothing, so the first list after
     * connecting does not replay old news.
     */
    fun between(before: List<RemoteSessionSummary>, after: List<RemoteSessionSummary>): List<SessionAlert> {
        val previous = before.associateBy { it.id }
        return after.mapNotNull { session ->
            val was = previous[session.id]?.status ?: return@mapNotNull null
            val now = session.status
            if (was == now) return@mapNotNull null
            val title = session.title.trim()
            when {
                now == RemoteSessionStatus.WaitingInput -> SessionAlert.NeedsYou(session.id, title)
                !was.running() -> null
                now == RemoteSessionStatus.Error -> SessionAlert.Failed(session.id, title)
                now == RemoteSessionStatus.Completed || now == RemoteSessionStatus.Idle -> SessionAlert.Finished(session.id, title)
                else -> null
            }
        }
    }

    /**
     * How long before the app leaves the screen an alert still counts as unseen. Android
     * reports the app gone only once the launcher settles, which can take seconds, so news
     * that arrives just after the user leaves looks as if it came while they were looking.
     */
    const val LEAVE_GRACE_MS = 15_000L

    /**
     * The alerts raised while the app still counted as on screen that are worth posting as it
     * leaves: recent ones only, the newest per session, and a question only while it still
     * waits for an answer.
     */
    fun dueOnLeaving(held: List<HeldAlert>, sessions: List<RemoteSessionSummary>, now: Long): List<SessionAlert> =
        held
            .filter { now - it.at <= LEAVE_GRACE_MS }
            .associateBy { it.alert.sessionId }
            .values
            .map { it.alert }
            .filter { alert ->
                alert !is SessionAlert.NeedsYou || sessions.firstOrNull { it.id == alert.sessionId }?.status == RemoteSessionStatus.WaitingInput
            }

    private fun RemoteSessionStatus.running(): Boolean =
        this == RemoteSessionStatus.Running || this == RemoteSessionStatus.Thinking || this == RemoteSessionStatus.WaitingInput
}

/** An alert raised while the app counted as on screen, and when. */
data class HeldAlert(val alert: SessionAlert, val at: Long)
