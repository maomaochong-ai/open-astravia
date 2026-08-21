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
import org.vetta.android.domain.device.SessionListItem
import org.vetta.android.domain.device.ConnectChannel
import org.vetta.android.domain.device.DesktopDevice
import org.vetta.android.domain.device.DeviceStatus
import org.vetta.android.ui.connect.DiscoverConnectScreen
import org.vetta.android.ui.connect.NewConversationScreen
import org.vetta.android.ui.home.HomeScreen
import org.vetta.android.ui.i18n.Str
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

        composeRule.onNodeWithText(Str.noDevicesHint).assertIsDisplayed()
        composeRule.onNodeWithText(Str.connectTitle).performClick()
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

        composeRule.onNodeWithText(Str.newConversation).performClick()
        composeRule.onNodeWithText(Str.useCloudAi).performClick()
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
                sourceLabel = Str.filterDesktop,
                timeLabel = "刚刚",
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

        composeRule.onNodeWithText(Str.newConversation).performClick()
        assertTrue(opened)
    }

    @Test
    fun sessionActionsRenameAndDeleteWithConfirmation() {
        val item =
            SessionListItem(
                id = "session-manage",
                title = "旧标题",
                subtitle = "",
                sourceLabel = Str.filterCloud,
                timeLabel = "刚刚",
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

        composeRule.onNodeWithContentDescription(Str.sessionActions).performClick()
        composeRule.onNodeWithText(Str.rename).performClick()
        composeRule.onNodeWithText(Str.sessionName).performTextClearance()
        composeRule.onNodeWithText(Str.sessionName).performTextInput("新标题")
        composeRule.onNodeWithText(Str.save).performClick()
        assertEquals(item.id to "新标题", renamed)

        composeRule.onNodeWithContentDescription(Str.sessionActions).performClick()
        composeRule.onNodeWithText(Str.delete).performClick()
        composeRule.onNodeWithText(Str.deleteSessionConfirm).assertIsDisplayed()
        composeRule.onNodeWithText(Str.delete).performClick()
        assertEquals(item.id, deletedId)
    }

    @Test
    fun sessionDeleteCanSkipConfirmationWhenPreferenceIsDisabled() {
        val item =
            SessionListItem(
                id = "session-direct-delete",
                title = "无需确认",
                subtitle = "",
                sourceLabel = Str.filterDesktop,
                timeLabel = "刚刚",
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

        composeRule.onNodeWithContentDescription(Str.sessionActions).performClick()
        composeRule.onNodeWithText(Str.delete).performClick()
        assertEquals(item.id, deletedId)
        assertEquals(0, composeRule.onAllNodesWithText(Str.deleteSessionConfirm).fetchSemanticsNodes().size)
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

        composeRule.onNodeWithText(Str.startConversation).performClick()
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

        composeRule.onNodeWithText(Str.themeDark).performClick()
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

        composeRule.onNodeWithText(Str.autoResume).performClick()
        composeRule.onNodeWithText(Str.pageMotion).performClick()
        composeRule.onNodeWithText(Str.confirmDeleteSession).performClick()

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

        composeRule.onNodeWithText(Str.clearLocalData).performClick()
        composeRule.onNodeWithText(Str.clearLocalDataTitle).assertIsDisplayed()
        composeRule.onNodeWithText(Str.clearLocalDataAction).performClick()
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

        composeRule.onNodeWithText(Str.aboutVetta).performClick()
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

        composeRule.onNodeWithText(Str.filterCloud).performClick()
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
        composeRule.onNodeWithText(Str.scanDesktop).assertIsDisplayed()
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

        composeRule.onNodeWithText(Str.lanAddressHint).performTextInput("192.168.1.8")
        composeRule.onNodeWithText(Str.connectAction).performClick()
        assertEquals("192.168.1.8", manualHost)

        composeRule.onNodeWithText(Str.channelCloud).performClick()
        composeRule.onNodeWithText(Str.useCloudAi).performClick()
        assertTrue(cloudOpened)
    }
}
