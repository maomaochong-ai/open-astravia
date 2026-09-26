package org.vetta.android.ui.board

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.runner.RunWith
import org.vetta.android.app.ThemeMode
import org.vetta.android.domain.remote.RemoteProjectSummary
import org.vetta.android.domain.remote.RemoteQuestionAnswer
import org.vetta.android.domain.remote.RemoteSessionState
import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.RemoteSessionSummary
import org.vetta.android.domain.remote.link.LinkSnapshot
import org.vetta.android.domain.remote.link.LinkStatus
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.domain.work.ModelChoice
import org.vetta.android.domain.work.PromptDraft
import org.vetta.android.resources.Res
import org.vetta.android.resources.board_empty
import org.vetta.android.ui.str
import org.vetta.android.ui.theme.VettaTheme
import org.vetta.android.ui.work.WorkActions
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@RunWith(AndroidJUnit4::class)
class TaskBoardSheetTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private object NoActions : WorkActions {
        override fun open(sessionId: String) = Unit

        override fun send(sessionId: String, draft: PromptDraft) = Unit

        override fun stop(sessionId: String) = Unit

        override fun resync(sessionId: String) = Unit

        override fun rename(sessionId: String, title: String) = Unit

        override fun setPinned(sessionId: String, pinned: Boolean) = Unit

        override fun delete(sessionId: String) = Unit

        override fun configure(sessionId: String, next: ModelChoice, current: RemoteSessionState) = Unit

        override fun setDraft(sessionId: String, draft: PromptDraft) = Unit

        override fun respond(sessionId: String, requestId: String, answers: List<RemoteQuestionAnswer>, cancelled: Boolean) = Unit

        override fun clearError() = Unit
    }

    private fun session(id: String, status: RemoteSessionStatus, cwd: String, name: String, at: Long) =
        RemoteSessionSummary(id, cwd, name, "标题 $id", null, at, status, false)

    private fun state(sessions: List<RemoteSessionSummary>) =
        MirrorState(
            ready = true,
            paired = true,
            link = LinkSnapshot(LinkStatus.Online, peerOnline = true),
            sessionsLoaded = true,
            sessions = sessions,
            // The board waits for the conversation bucket, so it never passes for a project.
            projects = listOf(RemoteProjectSummary("/conv", "对话", "conversation", 1)),
        )

    @Test
    fun cardsOpenTheirSessionsAndProjectPagesAndLeadToAllSessions() {
        var opened: String? = null
        var allSessions = false
        val board =
            state(
                listOf(
                    session("chat", RemoteSessionStatus.Completed, "/conv", "对话", 1),
                    session("run", RemoteSessionStatus.Running, "/code/app", "app", 2),
                ),
            )
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                TaskBoardSheet(board, NoActions, { opened = it }, {}, { allSessions = true }, {}, {})
            }
        }
        composeRule.onNodeWithTag("board.card.app").assertIsDisplayed()
        composeRule.onNodeWithTag("session.run").performClick()
        assertEquals("run", opened)

        composeRule.onNodeWithText("app").performClick()
        composeRule.onNodeWithTag("project./code/app").assertIsDisplayed()
        composeRule.onNodeWithTag("project.back").performClick()

        composeRule.onNodeWithTag("board.allSessions").performClick()
        assertTrue(allSessions)
    }

    @Test
    fun anEmptyBoardOffersNewSession() {
        var started = false
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                TaskBoardSheet(state(emptyList()), NoActions, {}, { started = true }, {}, {}, {})
            }
        }
        composeRule.onNodeWithText(str(Res.string.board_empty)).assertIsDisplayed()
        composeRule.onNodeWithTag("board.newSession").performClick()
        assertTrue(started)
    }
}
