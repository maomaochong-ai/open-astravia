package org.vetta.android.domain.work

import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.RemoteSessionSummary
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SessionFilterTest {
    private fun session(id: String, status: RemoteSessionStatus, at: Long, cwd: String = "/conv", name: String = "对话", pinnedAt: Long? = null) =
        RemoteSessionSummary(id, cwd, name, id, null, at, status, false, pinnedAt)

    private val sessions =
        listOf(
            session("chat-done", RemoteSessionStatus.Completed, 50),
            session("chat-ask", RemoteSessionStatus.WaitingInput, 10),
            session("app-run", RemoteSessionStatus.Running, 40, "/code/app", "app"),
            session("app-think", RemoteSessionStatus.Thinking, 45, "/code/app", "app"),
            session("app-fail", RemoteSessionStatus.Error, 30, "/code/app", "app"),
            session("web-ask", RemoteSessionStatus.WaitingInput, 20, "/code/web", "web"),
            session("web-stop", RemoteSessionStatus.Aborted, 60, "/code/web", "web"),
            session("web-idle", RemoteSessionStatus.Idle, 5, "/code/web", "web"),
        )

    private fun ids(filter: SessionFilter, list: List<RemoteSessionSummary> = sessions): List<String> =
        filter.apply(list, conversationCwd = "/conv").map { it.id }

    @Test
    fun groupsStatusesSoWaitingIsNotAlsoProcessing() {
        assertEquals(SessionStatusGroup.Waiting, SessionStatusGroup.of(RemoteSessionStatus.WaitingInput))
        assertEquals(
            listOf(SessionStatusGroup.Processing, SessionStatusGroup.Processing),
            listOf(RemoteSessionStatus.Running, RemoteSessionStatus.Thinking).map(SessionStatusGroup::of),
        )
        assertEquals(
            List(4) { SessionStatusGroup.Done },
            listOf(RemoteSessionStatus.Idle, RemoteSessionStatus.Completed, RemoteSessionStatus.Error, RemoteSessionStatus.Aborted).map(SessionStatusGroup::of),
        )
    }

    @Test
    fun pinsWaitingSessionsAboveEverythingElseThenNewestFirst() {
        assertEquals(listOf("web-ask", "chat-ask", "web-stop", "chat-done", "app-think", "app-run", "app-fail", "web-idle"), ids(SessionFilter()))
    }

    @Test
    fun putsPinnedSessionsOnTopNewestPinFirstWithinTheFilter() {
        val list =
            sessions.map {
                when (it.id) {
                    "chat-done" -> it.copy(pinnedAt = 100)
                    "web-stop" -> it.copy(pinnedAt = 200)
                    else -> it
                }
            }
        assertEquals(listOf("web-stop", "chat-done", "web-ask", "chat-ask"), ids(SessionFilter(), list).take(4))
        assertEquals(
            listOf("web-stop", "web-ask", "web-idle"),
            ids(SessionFilter(kind = SessionKind.Project, projectCwd = "/code/web"), list),
            "a pin only lifts the session where the filter shows it",
        )
    }

    @Test
    fun narrowsByStatusKindAndProject() {
        assertEquals(listOf("app-think", "app-run"), ids(SessionFilter(status = SessionStatusGroup.Processing)))
        assertEquals(listOf("chat-done"), ids(SessionFilter(status = SessionStatusGroup.Done, kind = SessionKind.Conversation)))
        assertEquals(listOf("web-ask", "web-stop", "app-think", "app-run", "app-fail", "web-idle"), ids(SessionFilter(kind = SessionKind.Project)))
        assertEquals(
            listOf("web-ask"),
            ids(SessionFilter(status = SessionStatusGroup.Waiting, kind = SessionKind.Project, projectCwd = "/code/web")),
        )
    }

    @Test
    fun leavingTheProjectKindForgetsTheChosenProject() {
        var filter = SessionFilter(kind = SessionKind.Project, projectCwd = "/code/app")
        filter = filter.withKind(SessionKind.Conversation)
        assertNull(filter.projectCwd)
        filter = filter.withKind(SessionKind.Project)
        assertEquals(6, ids(filter).size, "back to all projects, not the one picked before")
        assertNull(SessionFilter(kind = SessionKind.Conversation, projectCwd = "/code/app").projectCwd)
    }

    @Test
    fun isActiveOnlyWhenSomethingIsNarrowed() {
        assertFalse(SessionFilter().isActive)
        assertTrue(SessionFilter(status = SessionStatusGroup.Waiting).isActive)
        assertTrue(SessionFilter(kind = SessionKind.Conversation).isActive)
        val filter = SessionFilter(kind = SessionKind.Project, projectCwd = "/code/app")
        assertTrue(filter.isActive)
        assertFalse(filter.withKind(null).isActive, "clearing the kind also drops the project")
    }

    @Test
    fun listsTheProjectsThatHaveSessionsWithTheirCounts() {
        val projects = SessionFilter.projects(sessions, conversationCwd = "/conv")
        assertEquals(listOf("app", "web"), projects.map { it.name })
        assertEquals(listOf(3, 3), projects.map { it.count })
    }

    @Test
    fun treatsEverySessionAsAProjectUntilTheConversationBucketIsKnown() {
        assertTrue(SessionFilter(kind = SessionKind.Conversation).apply(sessions, conversationCwd = null).isEmpty())
        assertEquals(sessions.size, SessionFilter(kind = SessionKind.Project).apply(sessions, conversationCwd = null).size)
    }

    @Test
    fun scopeSetsKindAndProjectTogether() {
        var filter = SessionFilter(status = SessionStatusGroup.Waiting)
        assertEquals(ProjectScope.All, filter.scope)
        filter = filter.withScope(ProjectScope.Project("/a"))
        assertEquals(SessionFilter(SessionStatusGroup.Waiting, SessionKind.Project, "/a"), filter)
        assertEquals(ProjectScope.Project("/a"), filter.scope)
        filter = filter.withScope(ProjectScope.Conversations)
        assertEquals(SessionFilter(SessionStatusGroup.Waiting, SessionKind.Conversation), filter, "leaving a project drops its path")
        assertEquals(SessionFilter(SessionStatusGroup.Waiting), filter.withScope(ProjectScope.All))
        assertEquals(ProjectScope.All, SessionFilter(kind = SessionKind.Project).scope, "every project is not one the picker offers")
    }
}
