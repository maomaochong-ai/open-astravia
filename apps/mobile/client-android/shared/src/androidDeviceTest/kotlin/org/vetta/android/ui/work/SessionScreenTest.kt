package org.vetta.android.ui.work

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.runner.RunWith
import org.vetta.android.app.ThemeMode
import org.vetta.android.domain.remote.AssistantTurn
import org.vetta.android.domain.remote.RemoteModelOption
import org.vetta.android.domain.remote.RemoteQuestionAnswer
import org.vetta.android.domain.remote.RemoteSessionState
import org.vetta.android.domain.remote.RemoteQuestionRequest
import org.vetta.android.domain.remote.RemoteQuestionOption
import org.vetta.android.domain.remote.RemoteQuestionItem
import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.RemoteSessionSummary
import org.vetta.android.domain.remote.ToolCard
import org.vetta.android.domain.remote.ToolCardStatus
import org.vetta.android.domain.remote.TranscriptItem
import org.vetta.android.domain.remote.TranscriptState
import org.vetta.android.domain.remote.link.LinkSnapshot
import org.vetta.android.domain.remote.link.LinkStatus
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.domain.work.ModelChoice
import org.vetta.android.domain.work.PromptDraft
import org.vetta.android.resources.Res
import org.vetta.android.resources.chat_question_title
import org.vetta.android.resources.chat_model
import org.vetta.android.resources.chat_steps_done
import org.vetta.android.ui.str
import org.vetta.android.ui.theme.VettaTheme
import kotlin.test.Test
import kotlin.test.assertEquals

@RunWith(AndroidJUnit4::class)
class SessionScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private class RecordingActions : WorkActions {
        val calls = mutableListOf<String>()
        var drafts = mapOf<String, PromptDraft>()

        override fun open(sessionId: String) {
            calls += "open $sessionId"
        }

        override fun send(sessionId: String, draft: PromptDraft) {
            calls += "send $sessionId ${draft.text}"
        }

        override fun stop(sessionId: String) {
            calls += "stop $sessionId"
        }

        override fun resync(sessionId: String) {
            calls += "resync $sessionId"
        }

        override fun rename(sessionId: String, title: String) {
            calls += "rename $sessionId $title"
        }

        override fun setPinned(sessionId: String, pinned: Boolean) {
            calls += "pin $sessionId $pinned"
        }

        override fun delete(sessionId: String) {
            calls += "delete $sessionId"
        }

        override fun configure(sessionId: String, next: ModelChoice, current: RemoteSessionState) {
            calls += "configure $sessionId ${next.modelKey} ${next.thinkingLevel}"
        }

        override fun setDraft(sessionId: String, draft: PromptDraft) {
            drafts = drafts + (sessionId to draft)
        }

        override fun respond(sessionId: String, requestId: String, answers: List<RemoteQuestionAnswer>, cancelled: Boolean) {
            calls += "respond $sessionId $requestId ${answers.joinToString { it.question + "=" + it.answers.joinToString("+") }} $cancelled"
        }

        override fun clearError() = Unit
    }

    private val models =
        listOf(
            RemoteModelOption("anthropic/fable", "Claude Fable", "anthropic", listOf("off", "high"), supportsImage = true),
            RemoteModelOption("zai/glm-5", "GLM 5", "zai", listOf("none", "max"), supportsImage = false),
        )

    private fun state(status: RemoteSessionStatus, items: List<TranscriptItem>): MirrorState =
        MirrorState(
            ready = true,
            paired = true,
            link = LinkSnapshot(LinkStatus.Online, peerOnline = true),
            sessions = listOf(RemoteSessionSummary("s1", "/conv", "对话", "整理周报", null, 1, status, true)),
            models = mapOf("s1" to models),
            transcripts =
                mapOf(
                    "s1" to
                        TranscriptState.Empty.copy(
                            items = items,
                            loaded = true,
                            sessionState = RemoteSessionState(status, modelKey = "anthropic/fable", thinkingLevel = "high"),
                        ),
                ),
        )

    private val finishedTurn =
        listOf(
            TranscriptItem.User("u1", "帮我整理周报", 1_000),
            TranscriptItem.Assistant(
                AssistantTurn("a1", "", "先看看", listOf(ToolCard("t1", "web_search", ToolCardStatus.Done, args = """{"q":"周报"}""")), false, 2_000),
            ),
            TranscriptItem.Assistant(AssistantTurn("a2", "**已完成**", "", emptyList(), false, 3_000)),
            TranscriptItem.Assistant(AssistantTurn("a3", "", "", emptyList(), false, 4_000, error = "rate limited")),
            TranscriptItem.Assistant(AssistantTurn("a4", "", "", emptyList(), false, 5_000, error = "rate limited")),
        )

    @Test
    fun showsTheTurnFoldedWithItsCountedStepsAndRepeatedErrors() {
        val actions = RecordingActions()
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                SessionScreen("s1", state(RemoteSessionStatus.Completed, finishedTurn), PromptDraft(), actions, onBack = {})
            }
        }
        composeRule.onNodeWithText("整理周报").assertIsDisplayed()
        composeRule.onNodeWithText("帮我整理周报").assertIsDisplayed()
        composeRule.onNodeWithTag("chat.list").performScrollToNode(hasText("×2"))
        composeRule.onNodeWithText("×2").assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.plurals.chat_steps_done, 2)).performClick()
        composeRule.onNodeWithText("web_search: 周报").assertIsDisplayed()
        composeRule.onNodeWithTag("turn.copy").assertIsDisplayed()
        assertEquals(listOf("open s1"), actions.calls)
    }

    @Test
    fun sendsWhatIsTypedAndStopsARunningTurn() {
        val actions = RecordingActions()
        var current by mutableStateOf(state(RemoteSessionStatus.Completed, finishedTurn))
        // What the composer holds, fed back into the screen as the view model would.
        var typed by mutableStateOf(PromptDraft())
        val typing =
            object : WorkActions by actions {
                override fun setDraft(sessionId: String, draft: PromptDraft) {
                    typed = draft
                }
            }
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                SessionScreen("s1", current, typed, typing, onBack = {})
            }
        }
        composeRule.onNodeWithTag("composer.field").performTextInput("再写一份月报")
        composeRule.onNodeWithTag("composer.send").performClick()
        assertEquals("send s1 再写一份月报", actions.calls.last())

        current = state(RemoteSessionStatus.Running, finishedTurn)
        composeRule.onNodeWithTag("composer.stop").performClick()
        assertEquals("stop s1", actions.calls.last())
        composeRule.onNodeWithTag("turn.status").assertIsDisplayed()
    }

    @Test
    fun switchesModelAndLevelFromTheTitle() {
        val actions = RecordingActions()
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                SessionScreen("s1", state(RemoteSessionStatus.Completed, finishedTurn), PromptDraft(), actions, onBack = {})
            }
        }
        composeRule.onNodeWithTag("chat.modelMenu").performClick()
        composeRule.onNodeWithTag("modelSheet.model.zai/glm-5").performClick()
        assertEquals("configure s1 zai/glm-5 null", actions.calls.last(), "the level the new model lacks is dropped")
        composeRule.onNodeWithTag("modelSheet.level.max").performClick()
        assertEquals("configure s1 zai/glm-5 max", actions.calls.last())
        composeRule.onNodeWithText(str(Res.string.chat_model)).assertIsDisplayed()
    }

    private val question =
        RemoteQuestionRequest(
            "q1",
            listOf(
                RemoteQuestionItem("继续吗？", "确认", listOf(RemoteQuestionOption("继续", ""), RemoteQuestionOption("先停下", "")), false),
                RemoteQuestionItem("通知谁？", "通知", listOf(RemoteQuestionOption("产品", ""), RemoteQuestionOption("测试", "")), true),
            ),
        )

    private fun asking(): MirrorState {
        val base = state(RemoteSessionStatus.WaitingInput, finishedTurn)
        val transcript = base.transcript("s1")
        return base.copy(transcripts = mapOf("s1" to transcript.copy(pendingQuestion = question)))
    }

    @Test
    fun answersEveryQuestionInTurnThenSubmits() {
        val actions = RecordingActions()
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) { SessionScreen("s1", asking(), PromptDraft(), actions, onBack = {}) }
        }
        composeRule.onNodeWithTag("composer.field").assertDoesNotExist()
        composeRule.onNodeWithText(str(Res.string.chat_question_title)).assertIsDisplayed()
        composeRule.onNodeWithTag("question.next").assertIsNotEnabled()
        composeRule.onNodeWithTag("question.option.继续").performClick()
        composeRule.onNodeWithTag("question.next").performClick()

        composeRule.onNodeWithText("通知谁？").assertIsDisplayed()
        composeRule.onNodeWithTag("question.option.测试").performClick()
        composeRule.onNodeWithTag("question.other").performClick()
        composeRule.onNodeWithTag("question.otherField").performTextInput("设计")
        composeRule.onNodeWithTag("question.submit").performClick()
        assertEquals("respond s1 q1 继续吗？=继续, 通知谁？=测试+设计 false", actions.calls.last())
    }

    @Test
    fun cancelsTheQuestion() {
        val actions = RecordingActions()
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) { SessionScreen("s1", asking(), PromptDraft(), actions, onBack = {}) }
        }
        composeRule.onNodeWithTag("question.tab.1").performClick()
        composeRule.onNodeWithText("通知谁？").assertIsDisplayed()
        composeRule.onNodeWithTag("question.cancel").performClick()
        assertEquals("respond s1 q1  true", actions.calls.last())
    }
}
