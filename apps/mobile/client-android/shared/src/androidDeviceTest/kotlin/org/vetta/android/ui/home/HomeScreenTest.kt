package org.vetta.android.ui.home

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
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
import org.vetta.android.domain.work.ProjectScope
import org.vetta.android.domain.work.PromptDraft
import org.vetta.android.domain.work.SessionFilter
import org.vetta.android.domain.work.SessionStatusGroup
import org.vetta.android.resources.Res
import org.vetta.android.resources.app_name
import org.vetta.android.resources.home_connect_computer
import org.vetta.android.resources.link_connected
import org.vetta.android.resources.session_delete
import org.vetta.android.resources.session_pin
import org.vetta.android.resources.work_clear_filters
import org.vetta.android.resources.work_empty_filtered
import org.vetta.android.resources.work_group_waiting
import org.vetta.android.ui.str
import org.vetta.android.ui.theme.VettaTheme
import org.vetta.android.ui.work.WorkActions

@RunWith(AndroidJUnit4::class)
class HomeScreenTest {
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

        override fun respond(sessionId: String, requestId: String, answers: List<RemoteQuestionAnswer>, cancelled: Boolean) = Unit

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

    private fun setHome(
        filter: () -> SessionFilter = { SessionFilter() },
        onFilterChange: (SessionFilter) -> Unit = {},
        actions: WorkActions = RecordingActions(),
        onOpenSession: (String) -> Unit = {},
        onOpenProject: (String) -> Unit = {},
    ) {
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                HomeScreen(
                    state = paired,
                    filter = filter(),
                    onFilterChange = onFilterChange,
                    actions = actions,
                    entries = listOf(newSessionEntry {}),
                    onClose = {},
                    onOpenSession = onOpenSession,
                    onOpenProject = onOpenProject,
                    onOpenSettings = {},
                    onRefresh = {},
                    onRefreshProjects = {},
                    onReconnect = {},
                    onPair = {},
                )
            }
        }
    }

    @Test
    fun theNewSessionEntryNamesTheProjectItStartsIn() {
        var started = 0
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                HomeScreen(
                    state = paired,
                    filter = SessionFilter(),
                    onFilterChange = {},
                    actions = RecordingActions(),
                    entries = listOf(newSessionEntry("vetta") { started += 1 }),
                    onClose = {},
                    onOpenSession = {},
                    onOpenProject = {},
                    onOpenSettings = {},
                    onRefresh = {},
                    onRefreshProjects = {},
                    onReconnect = {},
                    onPair = {},
                )
            }
        }
        composeRule.onNodeWithTag("home.newSession.detail").assertTextEquals("vetta")
        composeRule.onNodeWithTag("home.newSession").performClick()
        assertEquals(1, started)
    }

    @Test
    fun connectComputerStaysInTheMenuNamesTheComputerAndOpensScanning() {
        var scans = 0
        showMenu {
            homeEntries(
                projectName = "vetta",
                computerName = "MacBook Pro",
                onNewSession = {},
                onOpenBoard = {},
                onConnect = { scans += 1 },
                onRemote = {},
            )
        }
        composeRule.onNodeWithText(str(Res.string.home_connect_computer)).assertIsDisplayed()
        composeRule.onNodeWithTag("home.connect.detail").assertTextEquals("MacBook Pro")
        assertTrue(top("home.newSession") < top("home.taskBoard"))
        assertTrue(top("home.taskBoard") < top("home.connect"))
        assertTrue(top("home.connect") < top("home.remote"))
        assertTrue(top("home.remote") < top("filter.status"))
        composeRule.onNodeWithTag("home.connect").performClick()
        assertEquals(1, scans)
    }

    @Test
    fun connectComputerStaysAvailableBeforeAComputerIsPaired() {
        var scans = 0
        showMenu {
            homeEntries(
                projectName = null,
                computerName = null,
                onNewSession = {},
                onOpenBoard = {},
                onConnect = { scans += 1 },
                onRemote = null,
            )
        }
        composeRule.onNodeWithTag("home.connect").assertIsDisplayed()
        composeRule.onAllNodesWithTag("home.connect.detail").assertCountEquals(0)
        composeRule.onAllNodesWithTag("home.remote").assertCountEquals(0)
        composeRule.onNodeWithTag("home.connect").performClick()
        assertEquals(1, scans)
    }

    private fun showMenu(entries: @Composable () -> List<HomeEntry>) {
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                HomeScreen(
                    state = paired,
                    filter = SessionFilter(),
                    onFilterChange = {},
                    actions = RecordingActions(),
                    entries = entries(),
                    onClose = {},
                    onOpenSession = {},
                    onOpenProject = {},
                    onOpenSettings = {},
                    onRefresh = {},
                    onRefreshProjects = {},
                    onReconnect = {},
                    onPair = {},
                )
            }
        }
    }

    @Test
    fun linkStatusSitsBesideTheTitleAndOpensItsDetail() {
        setHome()
        val name = composeRule.onNodeWithText(str(Res.string.app_name)).fetchSemanticsNode().boundsInRoot
        val status = composeRule.onNodeWithTag("link.status").fetchSemanticsNode().boundsInRoot
        val search = composeRule.onNodeWithTag("home.search").fetchSemanticsNode().boundsInRoot
        assertTrue(status.left >= name.right - 1f, "the status chip sits to the right of the name")
        assertTrue(status.top < name.bottom && status.bottom > name.top, "the status chip stays on the title row")
        assertTrue(status.bottom < search.top, "the status chip is no longer in the bottom bar")

        composeRule.onNodeWithTag("link.status").performClick()
        composeRule.onNodeWithText(str(Res.string.link_connected)).assertIsDisplayed()
    }

    @Test
    fun ordersPinnedThenWaitingThenNewestAndOpensARow() {
        var opened: String? = null
        setHome(onOpenSession = { opened = it })
        val order = listOf("pinned", "ask", "done", "run").map { top("session.$it") }
        assertEquals(order.sorted(), order, "pinned first, then the one waiting on you, then newest first")
        composeRule.onNodeWithTag("session.run").performClick()
        assertEquals("run", opened)
    }

    @Test
    fun filtersByStatusAndProjectAndClearsThem() {
        var filter by mutableStateOf(SessionFilter())
        setHome(filter = { filter }, onFilterChange = { filter = it })

        composeRule.onNodeWithTag("filter.status").performClick()
        composeRule.onNodeWithText(str(Res.string.work_group_waiting), substring = true).performClick()
        assertEquals(SessionStatusGroup.Waiting, filter.status)
        composeRule.onNodeWithTag("session.ask").assertIsDisplayed()
        composeRule.onAllNodesWithTag("session.done").assertCountEquals(0)

        composeRule.onNodeWithTag("filter.project").performClick()
        composeRule.onNodeWithTag("projectSheet./code/vetta").performClick()
        composeRule.waitForIdle()
        assertEquals(ProjectScope.Project("/code/vetta"), filter.scope)
        composeRule.onNodeWithText(str(Res.string.work_empty_filtered)).assertIsDisplayed()

        composeRule.onNodeWithText(str(Res.string.work_clear_filters)).performClick()
        assertEquals(SessionFilter(), filter)
        composeRule.onNodeWithTag("session.done").assertIsDisplayed()
    }

    @Test
    fun searchListsMatchingProjectsAndSessions() {
        var project: String? = null
        setHome(onOpenProject = { project = it })
        composeRule.onNodeWithTag("home.search").performClick()
        composeRule.onNodeWithTag("home.searchField").performTextInput("vetta")
        composeRule.onNodeWithTag("session.run").assertIsDisplayed()
        composeRule.onAllNodesWithTag("session.done").assertCountEquals(0)
        composeRule.onNodeWithTag("search.project./code/vetta").performClick()
        assertEquals("/code/vetta", project)

        composeRule.onNodeWithTag("home.searchCancel").performClick()
        composeRule.onNodeWithTag("session.done").assertIsDisplayed()
    }

    @Test
    fun longPressPinsAndDeleteAsksFirst() {
        val actions = RecordingActions()
        setHome(actions = actions)
        composeRule.onNodeWithTag("session.done").performTouchInput { longClick() }
        composeRule.onNodeWithText(str(Res.string.session_pin)).performClick()
        assertEquals("pin done true", actions.calls.last())

        composeRule.onNodeWithTag("session.done").performTouchInput { longClick() }
        composeRule.onNodeWithText(str(Res.string.session_delete)).performClick()
        assertEquals(1, actions.calls.size, "delete waits for the confirmation")
        composeRule.onNodeWithText(str(Res.string.session_delete)).performClick()
        assertEquals("delete done", actions.calls.last())
    }
}
