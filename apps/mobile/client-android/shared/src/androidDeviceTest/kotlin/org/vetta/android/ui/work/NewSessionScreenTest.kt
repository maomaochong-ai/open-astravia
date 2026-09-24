package org.vetta.android.ui.work

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.runner.RunWith
import org.vetta.android.app.ThemeMode
import org.vetta.android.domain.remote.RemoteModelOption
import org.vetta.android.domain.remote.RemoteProjectSummary
import org.vetta.android.domain.remote.link.LinkSnapshot
import org.vetta.android.domain.remote.link.LinkStatus
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.domain.work.ModelChoice
import org.vetta.android.domain.work.PromptDraft
import org.vetta.android.resources.Res
import org.vetta.android.resources.chat_level_max
import org.vetta.android.resources.new_session_offline
import org.vetta.android.resources.work_conversation
import org.vetta.android.ui.str
import org.vetta.android.ui.theme.VettaTheme
import kotlin.test.Test
import kotlin.test.assertEquals

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
        composeRule.onNodeWithText("vetta").performClick()

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
        composeRule.onNodeWithText(str(Res.string.new_session_offline)).assertIsDisplayed()
        composeRule.onNodeWithTag("newSession.location").assertIsNotEnabled()
    }
}
