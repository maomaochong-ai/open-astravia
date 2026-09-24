package org.vetta.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.runtime.mutableStateOf
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.runner.RunWith
import org.vetta.android.app.ThemeMode
import org.vetta.android.domain.session.nowEpochMs
import org.vetta.android.domain.device.SessionListItem
import org.vetta.android.domain.device.ConnectChannel
import org.vetta.android.domain.device.DesktopDevice
import org.vetta.android.domain.device.DeviceStatus
import org.vetta.android.ui.connect.DiscoverConnectScreen
import org.vetta.android.ui.connect.NewConversationScreen
import org.vetta.android.ui.home.HomeScreen
import org.vetta.android.resources.Res
import org.vetta.android.resources.about_vetta
import org.vetta.android.resources.auto_resume
import org.vetta.android.resources.channel_cloud
import org.vetta.android.resources.clear_local_data
import org.vetta.android.resources.clear_local_data_action
import org.vetta.android.resources.clear_local_data_title
import org.vetta.android.resources.confirm_delete_session
import org.vetta.android.resources.connect_action
import org.vetta.android.resources.connect_title
import org.vetta.android.resources.delete
import org.vetta.android.resources.delete_session_confirm
import org.vetta.android.resources.filter_cloud
import org.vetta.android.resources.filter_desktop
import org.vetta.android.resources.lan_address_hint
import org.vetta.android.resources.new_conversation
import org.vetta.android.resources.no_devices_hint
import org.vetta.android.resources.page_motion
import org.vetta.android.resources.rename
import org.vetta.android.resources.save
import org.vetta.android.resources.scan_desktop
import org.vetta.android.resources.session_actions
import org.vetta.android.resources.session_name
import org.vetta.android.resources.start_conversation
import org.vetta.android.resources.theme_dark
import org.vetta.android.resources.use_cloud_ai
import org.vetta.android.ui.me.SettingsScreen
import org.vetta.android.ui.sessions.SessionsScreen
import org.vetta.android.ui.theme.VettaTheme
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@RunWith(AndroidJUnit4::class)
class MainScreenInteractionsTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun emptyHomeOffersConnectionAction() {
        var opened = false
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                HomeScreen(
                    primaryDevice = null,
                    recentSessions = emptyList(),
                    onOpenDevice = {},
                    onOpenDevices = { opened = true },
                    onOpenSessions = {},
                    onOpenSession = {},
                    onNewConversation = {},
                    onUseCloudAi = {},
                )
            }
        }

        composeRule.onNodeWithText(str(Res.string.no_devices_hint)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.connect_title)).performClick()
        assertTrue(opened)
    }

    @Test
    fun connectedHomeDeviceOpensDeviceDetail() {
        var openedId: String? = null
        val device =
            DesktopDevice(
                id = "home-device",
                name = "Home Desktop",
                osLabel = "Windows",
                host = "192.168.1.10",
                status = DeviceStatus.Online,
            )
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                HomeScreen(
                    primaryDevice = device,
                    recentSessions = emptyList(),
                    onOpenDevice = { openedId = it },
                    onOpenDevices = {},
                    onOpenSessions = {},
                    onOpenSession = {},
                    onNewConversation = {},
                    onUseCloudAi = {},
                )
            }
        }

        composeRule.onNodeWithText(device.name).performClick()
        assertEquals(device.id, openedId)
    }

    @Test
    fun homeQuickActionsOpenConversationFlows() {
        val opened = mutableListOf<String>()
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                HomeScreen(
                    primaryDevice = null,
                    recentSessions = emptyList(),
                    onOpenDevice = {},
                    onOpenDevices = {},
                    onOpenSessions = {},
                    onOpenSession = {},
                    onNewConversation = { opened += "new" },
                    onUseCloudAi = { opened += "cloud" },
                )
            }
        }

        composeRule.onNodeWithText(str(Res.string.new_conversation)).performClick()
        composeRule.onNodeWithText(str(Res.string.use_cloud_ai)).performClick()
        assertEquals(listOf("new", "cloud"), opened)
    }

    @Test
    fun sessionListItemOpensExistingConversation() {
        var opened: SessionListItem? = null
        val item =
            SessionListItem(
                id = "session-1",
                title = "项目检查",
                subtitle = "",
                sourceLabel = str(Res.string.filter_desktop),
                updatedAtEpochMs = nowEpochMs(),
                isCloud = false,
            )
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                SessionsScreen(
                    sessions = listOf(item),
                    query = "",
                    filterIndex = 0,
                    onQueryChange = {},
                    onFilterChange = {},
                    onNewConversation = {},
                    onRenameSession = { _, _ -> },
                    onDeleteSession = {},
                    onOpenSession = { opened = it },
                )
            }
        }

        composeRule.onNodeWithText(item.title).performClick()
        assertEquals(item, opened)
    }

    @Test
    fun emptySessionsOffersNewConversationAction() {
        var opened = false
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                SessionsScreen(
                    sessions = emptyList(),
                    query = "",
                    filterIndex = 0,
                    onQueryChange = {},
                    onFilterChange = {},
                    onNewConversation = { opened = true },
                    onRenameSession = { _, _ -> },
                    onDeleteSession = {},
                    onOpenSession = {},
                )
            }
        }

        composeRule.onNodeWithText(str(Res.string.new_conversation)).performClick()
        assertTrue(opened)
    }

    @Test
    fun sessionActionsRenameAndDeleteWithConfirmation() {
        val item =
            SessionListItem(
                id = "session-manage",
                title = "旧标题",
                subtitle = "",
                sourceLabel = str(Res.string.filter_cloud),
                updatedAtEpochMs = nowEpochMs(),
                isCloud = true,
            )
        var renamed: Pair<String, String>? = null
        var deletedId: String? = null
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                SessionsScreen(
                    sessions = listOf(item),
                    query = "",
                    filterIndex = 0,
                    onQueryChange = {},
                    onFilterChange = {},
                    onOpenSession = {},
                    onNewConversation = {},
                    onRenameSession = { id, title -> renamed = id to title },
                    onDeleteSession = { deletedId = it },
                )
            }
        }

        composeRule.onNodeWithContentDescription(str(Res.string.session_actions)).performClick()
        composeRule.onNodeWithText(str(Res.string.rename)).performClick()
        composeRule.onNodeWithText(str(Res.string.session_name)).performTextClearance()
        composeRule.onNodeWithText(str(Res.string.session_name)).performTextInput("新标题")
        composeRule.onNodeWithText(str(Res.string.save)).performClick()
        assertEquals(item.id to "新标题", renamed)

        composeRule.onNodeWithContentDescription(str(Res.string.session_actions)).performClick()
        composeRule.onNodeWithText(str(Res.string.delete)).performClick()
        composeRule.onNodeWithText(str(Res.string.delete_session_confirm)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.delete)).performClick()
        assertEquals(item.id, deletedId)
    }

    @Test
    fun sessionDeleteCanSkipConfirmationWhenPreferenceIsDisabled() {
        val item =
            SessionListItem(
                id = "session-direct-delete",
                title = "无需确认",
                subtitle = "",
                sourceLabel = str(Res.string.filter_desktop),
                updatedAtEpochMs = nowEpochMs(),
                isCloud = false,
            )
        var deletedId: String? = null
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                SessionsScreen(
                    sessions = listOf(item),
                    query = "",
                    filterIndex = 0,
                    onQueryChange = {},
                    onFilterChange = {},
                    onOpenSession = {},
                    onNewConversation = {},
                    onRenameSession = { _, _ -> },
                    onDeleteSession = { deletedId = it },
                    confirmBeforeDelete = false,
                )
            }
        }

        composeRule.onNodeWithContentDescription(str(Res.string.session_actions)).performClick()
        composeRule.onNodeWithText(str(Res.string.delete)).performClick()
        assertEquals(item.id, deletedId)
        assertEquals(0, composeRule.onAllNodesWithText(str(Res.string.delete_session_confirm)).fetchSemanticsNodes().size)
    }

    @Test
    fun cloudConversationActionIsConnectedToCallback() {
        var started = false
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                NewConversationScreen(
                    devices = emptyList(),
                    channelIndex = 1,
                    onChannelChange = {},
                    onBack = {},
                    onStartDesktop = {},
                    onStartCloud = { started = true },
                    onConnectDesktop = {},
                )
            }
        }

        composeRule.onNodeWithText(str(Res.string.start_conversation)).performClick()
        assertTrue(started)
    }

    @Test
    fun settingsThemeSelectionCallsStateCallback() {
        var selected: ThemeMode? = null
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                SettingsScreen(
                    themeMode = ThemeMode.Light,
                    autoResumeLastSession = true,
                    motionEnabled = true,
                    onThemeMode = { selected = it },
                    onAutoResumeLastSession = {},
                    onMotionEnabled = {},
                    onClearLocalData = {},
                    onOpenAbout = {},
                    onBack = {},
                    confirmBeforeDelete = true,
                    onConfirmBeforeDelete = {},
                )
            }
        }

        composeRule.onNodeWithText(str(Res.string.theme_dark)).performClick()
        assertEquals(ThemeMode.Dark, selected)
    }

    @Test
    fun settingsBehaviorSwitchesCallStateCallbacks() {
        val values = mutableListOf<Boolean>()
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                SettingsScreen(
                    themeMode = ThemeMode.Light,
                    autoResumeLastSession = true,
                    motionEnabled = true,
                    onThemeMode = {},
                    onAutoResumeLastSession = { values += it },
                    onMotionEnabled = { values += it },
                    onClearLocalData = {},
                    onOpenAbout = {},
                    onBack = {},
                    confirmBeforeDelete = true,
                    onConfirmBeforeDelete = { values += it },
                )
            }
        }

        composeRule.onNodeWithText(str(Res.string.auto_resume)).performClick()
        composeRule.onNodeWithText(str(Res.string.page_motion)).performClick()
        composeRule.onNodeWithText(str(Res.string.confirm_delete_session)).performClick()

        assertEquals(listOf(false, false, false), values)
    }

    @Test
    fun settingsClearLocalDataRequiresConfirmationAndCallsCallback() {
        var cleared = false
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                SettingsScreen(
                    themeMode = ThemeMode.Light,
                    autoResumeLastSession = true,
                    motionEnabled = true,
                    onThemeMode = {},
                    onAutoResumeLastSession = {},
                    onMotionEnabled = {},
                    onClearLocalData = { cleared = true },
                    onOpenAbout = {},
                    onBack = {},
                    confirmBeforeDelete = true,
                    onConfirmBeforeDelete = {},
                )
            }
        }

        composeRule.onNodeWithText(str(Res.string.clear_local_data)).performClick()
        composeRule.onNodeWithText(str(Res.string.clear_local_data_title)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.clear_local_data_action)).performClick()
        assertTrue(cleared)
    }

    @Test
    fun settingsAboutRowCallsNavigationCallback() {
        var opened = false
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                SettingsScreen(
                    themeMode = ThemeMode.Light,
                    autoResumeLastSession = true,
                    motionEnabled = true,
                    onThemeMode = {},
                    onAutoResumeLastSession = {},
                    onMotionEnabled = {},
                    onClearLocalData = {},
                    onOpenAbout = { opened = true },
                    onBack = {},
                    confirmBeforeDelete = true,
                    onConfirmBeforeDelete = {},
                )
            }
        }

        composeRule.onNodeWithText(str(Res.string.about_vetta)).performClick()
        assertTrue(opened)
    }

    @Test
    fun sessionFilterSelectionCallsStateCallback() {
        var selected = -1
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                SessionsScreen(
                    sessions = emptyList(),
                    query = "",
                    filterIndex = 0,
                    onQueryChange = {},
                    onFilterChange = { selected = it },
                    onOpenSession = {},
                    onNewConversation = {},
                    onRenameSession = { _, _ -> },
                    onDeleteSession = {},
                )
            }
        }

        composeRule.onNodeWithText(str(Res.string.filter_cloud)).performClick()
        assertEquals(2, selected)
    }

    @Test
    fun remoteDiscoverUsesScanActionWithoutExposingConnectionAddress() {
        val device =
            DesktopDevice(
                id = "remote-test",
                name = "Remote Desktop",
                osLabel = "Windows",
                host = "wss://relay.example.test/internal-token",
                status = DeviceStatus.Online,
                channel = ConnectChannel.Remote,
            )
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                DiscoverConnectScreen(
                    devices = listOf(device),
                    channelIndex = 1,
                    onChannelChange = {},
                    onOpenDevice = {},
                    onConnectManual = {},
                    onUseCloud = {},
                )
            }
        }

        assertEquals(0, composeRule.onAllNodesWithText(device.host).fetchSemanticsNodes().size)
        composeRule.onNodeWithText(str(Res.string.scan_desktop)).assertIsDisplayed()
    }

    @Test
    fun discoverCloudAndManualLanActionsUseCallbacks() {
        var cloudOpened = false
        var manualHost: String? = null
        val channelIndex = mutableStateOf(0)
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                DiscoverConnectScreen(
                    devices = emptyList(),
                    channelIndex = channelIndex.value,
                    onChannelChange = { channelIndex.value = it },
                    onOpenDevice = {},
                    onConnectManual = { manualHost = it },
                    onUseCloud = { cloudOpened = true },
                )
            }
        }

        composeRule.onNodeWithText(str(Res.string.lan_address_hint)).performTextInput("192.168.1.8")
        composeRule.onNodeWithText(str(Res.string.connect_action)).performClick()
        assertEquals("192.168.1.8", manualHost)

        composeRule.onNodeWithText(str(Res.string.channel_cloud)).performClick()
        composeRule.onNodeWithText(str(Res.string.use_cloud_ai)).performClick()
        assertTrue(cloudOpened)
    }
}
