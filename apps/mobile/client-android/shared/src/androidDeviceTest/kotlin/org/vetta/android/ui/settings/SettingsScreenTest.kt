package org.vetta.android.ui.settings

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.runner.RunWith
import org.vetta.android.app.ThemeMode
import org.vetta.android.domain.remote.RemoteDeviceStatus
import org.vetta.android.domain.remote.link.LinkChannel
import org.vetta.android.domain.remote.link.LinkSnapshot
import org.vetta.android.domain.remote.link.LinkStatus
import org.vetta.android.domain.remote.pairing.StoredDesktop
import org.vetta.android.domain.work.ConfirmPolicy
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.resources.Res
import org.vetta.android.resources.link_latency
import org.vetta.android.resources.work_settings_load_value
import org.vetta.android.resources.work_settings_unpair
import org.vetta.android.ui.str
import org.vetta.android.ui.theme.VettaTheme
import kotlin.test.Test
import kotlin.test.assertEquals

@RunWith(AndroidJUnit4::class)
class SettingsScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val paired =
        MirrorState(
            ready = true,
            paired = true,
            desktop = StoredDesktop("key", "MacBook Pro", "pair-1"),
            link =
                LinkSnapshot(
                    LinkStatus.Online,
                    channel = LinkChannel.Relay,
                    rttMs = 42,
                    peerOnline = true,
                    desktop = RemoteDeviceStatus("MacBook Pro", null, emptyList(), true, 2),
                ),
        )

    @Test
    fun showsTheComputerAndChangesThePreferences() {
        var state by mutableStateOf(paired)
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                SettingsScreen(state, ThemeMode.Light, {}, { update -> state = state.copy(preferences = update(state.preferences)) }, onUnpair = {}, onPair = {}, onBack = {})
            }
        }
        composeRule.onNodeWithText("MacBook Pro").assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.link_latency, 42)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.plurals.work_settings_load_value, 2)).assertIsDisplayed()

        composeRule.onNodeWithTag("settings.policy.auto").performScrollTo().performClick()
        assertEquals(ConfirmPolicy.Auto, state.preferences.confirmPolicy)
        composeRule.onNodeWithTag("settings.policy.auto").assertIsSelected()

        composeRule.onNodeWithTag("settings.liveThinking").performScrollTo().performClick()
        composeRule.onNodeWithTag("settings.liveThinking").assertIsOff()
        assertEquals(false, state.preferences.liveThinking)
    }

    @Test
    fun unpairingAsksFirst() {
        var unpaired = 0
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                SettingsScreen(paired, ThemeMode.Light, {}, {}, onUnpair = { unpaired += 1 }, onPair = {}, onBack = {})
            }
        }
        composeRule.onNodeWithTag("settings.unpair").performScrollTo().performClick()
        assertEquals(0, unpaired, "nothing is forgotten before the confirmation")
        // The dialog's title and its confirm button read the same; the button comes last.
        composeRule.onAllNodesWithText(str(Res.string.work_settings_unpair)).onLast().performClick()
        assertEquals(1, unpaired)
    }

    @Test
    fun offersOnlyPairingWhenNoComputerIsPaired() {
        var pairing = 0
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                SettingsScreen(MirrorState(ready = true), ThemeMode.Light, {}, {}, onUnpair = {}, onPair = { pairing += 1 }, onBack = {})
            }
        }
        composeRule.onNodeWithTag("settings.scan").performClick()
        assertEquals(1, pairing)
        composeRule.onAllNodesWithTag("settings.unpair").assertCountEquals(0)
        composeRule.onAllNodesWithTag("settings.computer").assertCountEquals(0)
    }
}
