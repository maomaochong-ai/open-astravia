package org.vetta.android.ui.work

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.runner.RunWith
import org.vetta.android.app.ThemeMode
import org.vetta.android.core.nowEpochMs
import org.vetta.android.domain.remote.RemoteModelOption
import org.vetta.android.domain.remote.RemoteProjectSummary
import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.RemoteSessionSummary
import org.vetta.android.domain.remote.link.LinkSnapshot
import org.vetta.android.domain.remote.link.LinkStatus
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.domain.work.ModelChoice
import org.vetta.android.domain.work.PromptDraft
import org.vetta.android.resources.Res
import org.vetta.android.resources.chat_level_max
import org.vetta.android.resources.work_conversation
import org.vetta.android.ui.str
import org.vetta.android.ui.theme.VettaTheme
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@RunWith(AndroidJUnit4::class)
class NewSessionScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val online =
        MirrorState(
            ready = true,
            paired = true,
            link = LinkSnapshot(LinkStatus.Online, peerOnline = true),
            projects = listOf(RemoteProjectSummary("/conv", "对话", "conversation", 1), RemoteProjectSummary("/code/vetta", "vetta", "project", 2)),
            newSessionModels = listOf(RemoteModelOption("zai/glm-5", "GLM 5", "zai", listOf("none", "max"), supportsImage = false)),
        )

    @Test
    fun startsInTheChosenProjectOnTheChosenModel() {
        var draft by mutableStateOf(PromptDraft())
        var started: NewSessionStart? = null
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                NewSessionScreen(online, draft, { draft = it }, null, null, {}, { started = it }, {}, {})
            }
        }
        composeRule.onNodeWithText(str(Res.string.work_conversation)).assertIsDisplayed()
        composeRule.onNodeWithTag("newSession.location").performClick()
        composeRule.onNodeWithTag("projectSheet./code/vetta").performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("newSession.model").performClick()
        composeRule.onNodeWithTag("modelSheet.model.zai/glm-5").performClick()
        composeRule.onNodeWithTag("modelSheet.level.max").performClick()
        composeRule.onNodeWithTag("modelSheet.done").performClick()

        composeRule.onNodeWithTag("composer.field").performTextInput("跑一下测试")
        composeRule.onNodeWithTag("composer.send").performClick()
        assertEquals(NewSessionStart(PromptDraft("跑一下测试"), "/code/vetta", ModelChoice("zai/glm-5", "max")), started)
    }

    @Test
    fun putsBackWhatAFailedStartHad() {
        var draft by mutableStateOf(PromptDraft())
        val restored = NewSessionStart(PromptDraft("没发出去的"), "/code/vetta", ModelChoice("zai/glm-5", "max"))
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                NewSessionScreen(online, draft, { draft = it }, null, restored, {}, {}, {}, {})
            }
        }
        composeRule.waitForIdle()
        assertEquals("没发出去的", draft.text)
        composeRule.onNodeWithText("vetta").assertIsDisplayed()
        composeRule.onNodeWithText("GLM 5 · ${str(Res.string.chat_level_max)}").assertIsDisplayed()
    }

    @Test
    fun waitsForTheComputerWhileItIsOffline() {
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                NewSessionScreen(online.copy(link = LinkSnapshot.Offline), PromptDraft("写好的"), {}, null, null, {}, {}, {}, {})
            }
        }
        // The link pill stands where the composer goes until the computer answers.
        composeRule.onNodeWithTag("link.status").assertIsDisplayed()
        composeRule.onNodeWithTag("composer.field").assertDoesNotExist()
    }

    @Test
    fun glanceOpensTheSessionThatNeedsYouAndTheRestOfTheBoard() {
        val now = nowEpochMs()
        val withWork =
            online.copy(
                sessionsLoaded = true,
                sessions =
                    listOf(
                        RemoteSessionSummary("ask", "/code/app", "登录项目", "修复登录页", "要不要继续", now, RemoteSessionStatus.WaitingInput, false),
                        RemoteSessionSummary("extra", "/code/docs", "文档", "补一篇说明", "第三件在等", now - 2_000, RemoteSessionStatus.WaitingInput, false),
                        RemoteSessionSummary("run", "/code/web", "官网", "打包脚本", "签名失败", now - 1_000, RemoteSessionStatus.Running, false),
                    ),
            )
        var opened: String? = null
        var board = false
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                NewSessionScreen(withWork, PromptDraft(), {}, null, null, {}, {}, {}, {}, onOpenBoard = { board = true }, onOpenSession = { opened = it })
            }
        }
        composeRule.onNodeWithText("修复登录页").assertIsDisplayed()
        composeRule.onNodeWithText("要不要继续").assertIsDisplayed()
        composeRule.onNodeWithText("补一篇说明").assertIsDisplayed()
        composeRule.onNodeWithText("打包脚本").assertDoesNotExist()
        composeRule.onNodeWithTag("session.ask").performClick()
        assertEquals("ask", opened)
        composeRule.onNodeWithTag("newSession.board").performClick()
        assertTrue(board)
    }
}
