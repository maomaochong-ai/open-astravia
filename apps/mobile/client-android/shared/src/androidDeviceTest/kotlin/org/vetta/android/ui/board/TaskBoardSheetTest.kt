package org.vetta.android.ui.board

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.runner.RunWith
import org.vetta.android.app.ThemeMode
import org.vetta.android.core.nowEpochMs
import org.vetta.android.domain.remote.RemoteQuestionAnswer
import org.vetta.android.domain.remote.RemoteSessionState
import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.RemoteSessionSummary
import org.vetta.android.domain.remote.link.LinkSnapshot
import org.vetta.android.domain.remote.link.LinkStatus
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.domain.work.ModelChoice
import org.vetta.android.domain.work.PromptDraft
import org.vetta.android.domain.work.TaskBoard
import org.vetta.android.resources.Res
import org.vetta.android.resources.board_empty
import org.vetta.android.resources.board_section_running_empty
import org.vetta.android.resources.board_section_stopped_empty
import org.vetta.android.resources.board_section_waiting
import org.vetta.android.resources.board_section_waiting_empty
import org.vetta.android.resources.board_stale
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

    private fun session(id: String, status: RemoteSessionStatus, cwd: String, name: String, title: String, preview: String?, at: Long) =
        RemoteSessionSummary(id, cwd, name, title, preview, at, status, false)

    private fun state(sessions: List<RemoteSessionSummary>, online: Boolean = true) =
        MirrorState(
            ready = true,
            paired = true,
            link = if (online) LinkSnapshot(LinkStatus.Online, peerOnline = true) else LinkSnapshot.Offline,
            sessionsLoaded = true,
            sessions = sessions,
            projects = listOf(),
        )

    @Test
    fun showsWhatNeedsYouWhatIsRunningAndWhatJustStopped() {
        val now = nowEpochMs()
        var opened: String? = null
        var allSessions = false
        val board =
            state(
                listOf(
                    session("ask", RemoteSessionStatus.WaitingInput, "/code/app", "登录项目", "修复登录页", "要不要继续改登录页", now - 60_000),
                    session("run", RemoteSessionStatus.Running, "/code/web", "官网", "打包脚本", "签名还在失败", now - 120_000),
                    session("done", RemoteSessionStatus.Completed, "/code/docs", "文档", "更新安装文档", "链接已经改好", now - 10 * 60_000),
                    session("old", RemoteSessionStatus.Completed, "/code/old", "旧项目", "上周的整理", "这是上周的摘要", now - TaskBoard.STOPPED_WINDOW_MS - 60_000),
                ),
            )
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                TaskBoardSheet(board, NoActions, { opened = it }, {}, { allSessions = true }, {}, {})
            }
        }
        composeRule.onNodeWithText(str(Res.string.board_section_waiting), substring = true).assertIsDisplayed()
        composeRule.onNodeWithText("要不要继续改登录页").assertIsDisplayed()
        composeRule.onNodeWithText("登录项目").assertIsDisplayed()
        composeRule.onNodeWithText("签名还在失败").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("链接已经改好").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("这是上周的摘要").assertDoesNotExist()
        composeRule.onNodeWithText(str(Res.string.board_section_running_empty)).assertDoesNotExist()

        composeRule.onNodeWithTag("session.ask").performClick()
        assertEquals("ask", opened)

        composeRule.onNodeWithTag("board.allSessions").performScrollTo().performClick()
        assertTrue(allSessions)
    }

    @Test
    fun saysWhenNothingIsWaitingOrJustStopped() {
        val now = nowEpochMs()
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                TaskBoardSheet(
                    state(listOf(session("run", RemoteSessionStatus.Running, "/code/web", "官网", "打包脚本", "还在签名", now))),
                    NoActions,
                    {},
                    {},
                    {},
                    {},
                    {},
                )
            }
        }
        composeRule.onNodeWithText(str(Res.string.board_section_waiting_empty)).assertIsDisplayed()
        composeRule.onNodeWithText("还在签名").assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.board_section_stopped_empty)).assertIsDisplayed()
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

    @Test
    fun anOfflineBoardSaysTheListIsFromLastTime() {
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                TaskBoardSheet(state(emptyList(), online = false), NoActions, {}, {}, {}, {}, {})
            }
        }
        composeRule.onNodeWithText(str(Res.string.board_stale), substring = true).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.board_empty)).assertIsDisplayed()
    }
}
