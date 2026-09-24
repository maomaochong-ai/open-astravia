package org.vetta.android.ui.work

import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.longClick
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
import org.vetta.android.domain.work.SessionFilter
import org.vetta.android.resources.Res
import org.vetta.android.resources.session_delete
import org.vetta.android.resources.session_pin
import org.vetta.android.resources.work_empty_filtered
import org.vetta.android.resources.work_kind_project
import org.vetta.android.resources.work_unpaired_title
import org.vetta.android.ui.str
import org.vetta.android.ui.theme.VettaTheme
import kotlin.test.Test
import kotlin.test.assertEquals

@RunWith(AndroidJUnit4::class)
class WorkScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private class RecordingActions : WorkActions {
        val calls = mutableListOf<String>()

        override fun open(sessionId: String) = Unit

        override fun send(sessionId: String, draft: PromptDraft) = Unit

        override fun stop(sessionId: String) = Unit

        override fun resync(sessionId: String) = Unit

        override fun rename(sessionId: String, title: String) = Unit

        override fun setPinned(sessionId: String, pinned: Boolean) {
            calls += "pin $sessionId $pinned"
        }

        override fun delete(sessionId: String) {
            calls += "delete $sessionId"
        }

        override fun configure(sessionId: String, next: ModelChoice, current: RemoteSessionState) = Unit

        override fun setDraft(sessionId: String, draft: PromptDraft) = Unit

        override fun respond(sessionId: String, requestId: String, answers: List<RemoteQuestionAnswer>, cancelled: Boolean) {
            calls += "respond $sessionId $requestId ${answers.joinToString { it.question + "=" + it.answers.joinToString("+") }} $cancelled"
        }

        override fun clearError() = Unit
    }

    private fun session(id: String, status: RemoteSessionStatus, at: Long, cwd: String = "/conv", pinnedAt: Long? = null) =
        RemoteSessionSummary(id, cwd, if (cwd == "/conv") "对话" else "vetta", "标题 $id", "预览 $id", at, status, false, pinnedAt)

    private val paired =
        MirrorState(
            ready = true,
            paired = true,
            link = LinkSnapshot(LinkStatus.Online, peerOnline = true),
            sessionsLoaded = true,
            projects = listOf(RemoteProjectSummary("/conv", "对话", "conversation", 2), RemoteProjectSummary("/code/vetta", "vetta", "project", 2)),
            sessions =
                listOf(
                    session("done", RemoteSessionStatus.Completed, 50),
                    session("ask", RemoteSessionStatus.WaitingInput, 10),
                    session("run", RemoteSessionStatus.Running, 40, "/code/vetta"),
                    session("pinned", RemoteSessionStatus.Idle, 5, "/code/vetta", pinnedAt = 100),
                ),
        )

    private fun top(tag: String): Float = composeRule.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot.top

    @Test
    fun ordersPinnedThenWaitingThenNewestAndOpensARow() {
        var opened: String? = null
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                WorkScreen(paired, SessionFilter(), {}, RecordingActions(), { opened = it }, {}, {}, pairing = {})
            }
        }
        val order = listOf("pinned", "ask", "done", "run").map { top("session.$it") }
        assertEquals(order.sorted(), order, "pinned first, then the one waiting on you, then newest first")
        composeRule.onNodeWithText("标题 run").performClick()
        assertEquals("run", opened)
    }

    @Test
    fun filtersByStatusAndKindAndClearsThem() {
        var filter by mutableStateOf(SessionFilter())
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                WorkScreen(paired, filter, { filter = it }, RecordingActions(), {}, {}, {}, pairing = {})
            }
        }
        composeRule.onNodeWithTag("filter.status.waiting").performClick()
        composeRule.onNodeWithTag("session.ask").assertIsDisplayed()
        composeRule.onAllNodesWithTag("session.done").assertCountEquals(0)

        composeRule.onNodeWithTag("filter.kind").performClick()
        composeRule.onNodeWithText(str(Res.string.work_kind_project)).performClick()
        composeRule.onNodeWithText(str(Res.string.work_empty_filtered)).assertIsDisplayed()

        composeRule.onNodeWithTag("filter.clearChip").performClick()
        assertEquals(SessionFilter(), filter)
        composeRule.onNodeWithTag("session.done").assertIsDisplayed()
    }

    @Test
    fun longPressPinsAndDeleteAsksFirst() {
        val actions = RecordingActions()
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                WorkScreen(paired, SessionFilter(), {}, actions, {}, {}, {}, pairing = {})
            }
        }
        composeRule.onNodeWithTag("session.done").performTouchInput { longClick() }
        composeRule.onNodeWithText(str(Res.string.session_pin)).performClick()
        assertEquals("pin done true", actions.calls.last())

        composeRule.onNodeWithTag("session.done").performTouchInput { longClick() }
        composeRule.onNodeWithText(str(Res.string.session_delete)).performClick()
        assertEquals(1, actions.calls.size, "delete waits for the confirmation")
        composeRule.onAllNodesWithTag("session.done").assertCountEquals(1)
        composeRule.onNodeWithText(str(Res.string.session_delete)).performClick()
        assertEquals("delete done", actions.calls.last())
    }

    @Test
    fun offersPairingUntilADesktopIsPaired() {
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                WorkScreen(MirrorState(ready = true), SessionFilter(), {}, RecordingActions(), {}, {}, {}, pairing = { Text("SCAN") })
            }
        }
        composeRule.onNodeWithText(str(Res.string.work_unpaired_title)).assertIsDisplayed()
        composeRule.onNodeWithText("SCAN").assertIsDisplayed()
    }
}
