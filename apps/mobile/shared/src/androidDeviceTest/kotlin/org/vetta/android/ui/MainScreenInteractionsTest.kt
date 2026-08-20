package org.vetta.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.runner.RunWith
import org.vetta.android.app.ThemeMode
import org.vetta.android.domain.device.SessionListItem
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
                    onOpenSession = { opened = it },
                )
            }
        }

        composeRule.onNodeWithText(item.title).performClick()
        assertEquals(item, opened)
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
                    onThemeMode = { selected = it },
                    onBack = {},
                )
            }
        }

        composeRule.onNodeWithText(Str.themeDark).performClick()
        assertEquals(ThemeMode.Dark, selected)
    }
}
