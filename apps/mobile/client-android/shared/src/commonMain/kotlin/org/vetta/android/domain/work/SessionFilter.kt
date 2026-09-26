package org.vetta.android.domain.work

import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.RemoteSessionSummary

/**
 * The status groups the work list filters by. Sessions waiting on the user's
 * answer are their own group, apart from those still running on their own.
 */
enum class SessionStatusGroup {
    Waiting,
    Processing,
    Done,
    ;

    companion object {
        fun of(status: RemoteSessionStatus): SessionStatusGroup =
            when (status) {
                RemoteSessionStatus.WaitingInput -> Waiting
                RemoteSessionStatus.Running, RemoteSessionStatus.Thinking -> Processing
                RemoteSessionStatus.Idle,
                RemoteSessionStatus.Completed,
                RemoteSessionStatus.Error,
                RemoteSessionStatus.Aborted,
                -> Done
            }
    }
}

enum class SessionKind {
    Conversation,
    Project,
}

/** What the project picker chooses: every session, the desktop's conversations, or one project. */
sealed interface ProjectScope {
    data object All : ProjectScope

    data object Conversations : ProjectScope

    data class Project(val cwd: String) : ProjectScope
}

/** A project that has sessions, for the project filter. */
data class ProjectFilterOption(val cwd: String, val name: String, val count: Int)

/**
 * What the work list shows: a status group, a kind, and within projects one project.
 * [projectCwd] only survives while [kind] is [SessionKind.Project]; use [withKind]
 * to change the kind so a project picked before is forgotten.
 */
class SessionFilter(
    val status: SessionStatusGroup? = null,
    val kind: SessionKind? = null,
    projectCwd: String? = null,
) {
    val projectCwd: String? = if (kind == SessionKind.Project) projectCwd else null

    fun withStatus(status: SessionStatusGroup?): SessionFilter = SessionFilter(status, kind, projectCwd)

    fun withKind(kind: SessionKind?): SessionFilter = SessionFilter(status, kind, if (kind == SessionKind.Project) projectCwd else null)

    fun withProject(projectCwd: String?): SessionFilter = SessionFilter(status, kind, projectCwd)

    /** The kind and project as one choice, as the project picker sets them. */
    val scope: ProjectScope
        get() =
            when (kind) {
                null -> ProjectScope.All
                SessionKind.Conversation -> ProjectScope.Conversations
                SessionKind.Project -> projectCwd?.let(ProjectScope::Project) ?: ProjectScope.All
            }

    fun withScope(scope: ProjectScope): SessionFilter =
        when (scope) {
            ProjectScope.All -> SessionFilter(status)
            ProjectScope.Conversations -> SessionFilter(status, SessionKind.Conversation)
            is ProjectScope.Project -> SessionFilter(status, SessionKind.Project, scope.cwd)
        }

    /** Anything narrowed down; the default state shows every session. */
    val isActive: Boolean
        get() = this != SessionFilter()

    /**
     * `conversationCwd` tells conversations from projects; while it is unknown
     * every session counts as a project.
     */
    fun matches(session: RemoteSessionSummary, conversationCwd: String?): Boolean {
        if (status != null && SessionStatusGroup.of(session.status) != status) return false
        return when (kind) {
            null -> true
            SessionKind.Conversation -> session.projectCwd == conversationCwd
            SessionKind.Project -> session.projectCwd != conversationCwd && (projectCwd == null || session.projectCwd == projectCwd)
        }
    }

    /**
     * Filtered and ordered for display: pinned sessions first (newest pin on top),
     * then those waiting on the user, then newest first.
     */
    fun apply(sessions: List<RemoteSessionSummary>, conversationCwd: String?): List<RemoteSessionSummary> =
        ordered(sessions.filter { matches(it, conversationCwd) })

    override fun equals(other: Any?): Boolean =
        other is SessionFilter && other.status == status && other.kind == kind && other.projectCwd == projectCwd

    override fun hashCode(): Int = (status?.hashCode() ?: 0) * 31 * 31 + (kind?.hashCode() ?: 0) * 31 + (projectCwd?.hashCode() ?: 0)

    override fun toString(): String = "SessionFilter(status=$status, kind=$kind, projectCwd=$projectCwd)"

    companion object {
        fun ordered(sessions: List<RemoteSessionSummary>): List<RemoteSessionSummary> =
            sessions.sortedWith(
                compareByDescending<RemoteSessionSummary> { it.pinnedAt ?: Long.MIN_VALUE }
                    .thenByDescending { it.status == RemoteSessionStatus.WaitingInput }
                    .thenByDescending { it.updatedAt },
            )

        /** The projects that have sessions, for the project filter, with their counts. */
        fun projects(sessions: List<RemoteSessionSummary>, conversationCwd: String?): List<ProjectFilterOption> {
            val byCwd = linkedMapOf<String, ProjectFilterOption>()
            for (session in sessions) {
                if (session.projectCwd == conversationCwd) continue
                val known = byCwd[session.projectCwd]
                byCwd[session.projectCwd] = known?.copy(count = known.count + 1) ?: ProjectFilterOption(session.projectCwd, session.projectName, 1)
            }
            return byCwd.values.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
        }
    }
}
