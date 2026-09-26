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

    private fun RemoteSessionStatus.running(): Boolean =
        this == RemoteSessionStatus.Running || this == RemoteSessionStatus.Thinking || this == RemoteSessionStatus.WaitingInput
}
