package org.vetta.android.domain.work

import org.vetta.android.domain.remote.RemoteProjectSummary
import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.RemoteSessionSummary
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HomeDigestTest {
    private fun session(
        id: String,
        cwd: String = "/conv",
        name: String = "对话",
        title: String = id,
        preview: String? = null,
        at: Long,
    ) = RemoteSessionSummary(id, cwd, name, title, preview, at, RemoteSessionStatus.Completed, false)

    @Test
    fun listsProjectsMostRecentFirstAndLeavesConversationsOut() {
        val sessions =
            listOf(
                session("chat", at = 100),
                session("a1", "/a", "a", at = 10),
                session("b1", "/b", "b", at = 50),
                session("a2", "/a", "a", at = 60),
            )
        val all = ProjectDigest.all(sessions, conversationCwd = "/conv")
        assertEquals(listOf("/a", "/b"), all.map { it.cwd })
        assertEquals(2, all[0].sessionCount)
        assertEquals(60, all[0].updatedAt)
    }

    @Test
    fun listsNothingUntilTheConversationBucketIsKnown() {
        assertTrue(ProjectDigest.all(listOf(session("x", "/a", "a", at = 1)), conversationCwd = null).isEmpty())
    }

    @Test
    fun allProjectsAddsDesktopProjectsWithoutSessionsAtTheEnd() {
        val sessions = listOf(session("a1", "/a", "a", at = 10))
        val projects =
            listOf(
                RemoteProjectSummary("/conv", "对话", "conversation", 9),
                RemoteProjectSummary("/a", "a", "project", 7),
                RemoteProjectSummary("/z", "z", "project", 3),
            )
        val all = ProjectDigest.all(sessions, projects, conversationCwd = "/conv")
        assertEquals(listOf("/a", "/z"), all.map { it.cwd })
        assertEquals(listOf(1, 3), all.map { it.sessionCount }, "a project with sessions counts what the list shows")
    }

    @Test
    fun searchMatchesTitlePreviewAndProjectIgnoringCase() {
        val row = session("s", "/a", "Mobile App", "Dock 液态玻璃", "Fix the Aurora glow", at = 1)
        assertTrue(HomeSearch.matches(row, ""))
        assertTrue(HomeSearch.matches(row, "  "))
        assertTrue(HomeSearch.matches(row, "液态"))
        assertTrue(HomeSearch.matches(row, "aurora"))
        assertTrue(HomeSearch.matches(row, "mobile"))
        assertTrue(HomeSearch.matches(row, "dock glow"), "every word must match, each anywhere")
        assertFalse(HomeSearch.matches(row, "dock desktop"))
    }

    @Test
    fun searchIgnoresAccentsAndFullWidthLetters() {
        val row = session("s", "/a", "Café", "ＲＥＡＤＭＥ 更新", at = 1)
        assertTrue(HomeSearch.matches(row, "cafe"))
        assertTrue(HomeSearch.matches(row, "readme"))
        assertTrue(HomeSearch.matches(row, "ｃａｆé"))
    }

    @Test
    fun projectSearchNeedsAQuery() {
        val project = ProjectDigest("/a", "智能助手工作流", 1, 1)
        assertFalse(HomeSearch.matches(project, ""))
        assertTrue(HomeSearch.matches(project, "助手"))
        assertFalse(HomeSearch.matches(project, "客服"))
    }
}
