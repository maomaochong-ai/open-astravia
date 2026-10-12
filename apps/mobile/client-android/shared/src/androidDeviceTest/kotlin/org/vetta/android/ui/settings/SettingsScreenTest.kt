package org.vetta.android.ui.settings

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlin.test.Test
import kotlin.test.assertEquals
import org.junit.Rule
import org.junit.runner.RunWith
import org.vetta.android.app.ThemeMode
import org.vetta.android.domain.remote.RemoteDeviceStatus
import org.vetta.android.domain.remote.link.LinkChannel
import org.vetta.android.domain.remote.link.LinkSnapshot
import org.vetta.android.domain.remote.link.LinkStatus
import org.vetta.android.domain.remote.pairing.StoredDesktop
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.domain.work.UnlinkReason
import org.vetta.android.resources.Res
import org.vetta.android.resources.link_connected
import org.vetta.android.resources.link_connecting
import org.vetta.android.resources.link_live
import org.vetta.android.resources.link_latency
import org.vetta.android.resources.link_via_relay
import org.vetta.android.resources.settings_link_phone
import org.vetta.android.resources.unlinked_description
import org.vetta.android.resources.unlinked_pill
import org.vetta.android.resources.work_settings_unpair
import org.vetta.android.resources.work_unpaired_description
import org.vetta.android.ui.str
import org.vetta.android.ui.theme.VettaTheme

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
        composeRule.onNodeWithText(phoneModel()).assertDoesNotExist()
        composeRule.onNodeWithText(str(Res.string.settings_link_phone)).assertDoesNotExist()
        composeRule.onNodeWithText(str(Res.string.link_connected)).assertDoesNotExist()
        composeRule.onNodeWithText(str(Res.string.link_live)).assertIsDisplayed()
        composeRule.onAllNodesWithTag("settings.computer").assertCountEquals(0)
        composeRule.onNodeWithText("${str(Res.string.link_via_relay)} · ${str(Res.string.link_latency, 42)}").assertIsDisplayed()
        composeRule.onNodeWithText("—").assertDoesNotExist()

        // The desktop asks for no confirmations yet: no choice is offered that would change nothing.
        composeRule.onAllNodesWithTag("settings.policy.auto").assertCountEquals(0)

        composeRule.onNodeWithTag("settings.liveThinking").performScrollTo().performClick()
        composeRule.onNodeWithTag("settings.liveThinking").assertIsOff()
        assertEquals(false, state.preferences.liveThinking)
    }

    @Test
    fun switchesTheAppearance() {
        var mode by mutableStateOf(ThemeMode.Light)
        composeRule.setContent {
            VettaTheme(mode) {
                SettingsScreen(MirrorState(ready = true), mode, { mode = it }, {}, onUnpair = {}, onPair = {}, onBack = {})
            }
        }
        composeRule.onNodeWithTag("settings.theme.dark").performScrollTo().performClick()
        assertEquals(ThemeMode.Dark, mode)
        composeRule.onNodeWithTag("settings.theme.dark").assertIsSelected()
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
    fun afterUnpairingOffersAFreshScanAndDoesNotSayItIsConnecting() {
        var pairing = 0
        val unlinked =
            paired.copy(
                paired = false,
                unlinked = UnlinkReason.UnpairedHere,
                link = LinkSnapshot.Offline,
            )
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                SettingsScreen(unlinked, ThemeMode.Light, {}, {}, onUnpair = {}, onPair = { pairing += 1 }, onBack = {})
            }
        }
        composeRule.onNodeWithText("MacBook Pro").assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.unlinked_pill)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.unlinked_description)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.link_connecting)).assertDoesNotExist()
        composeRule.onNodeWithText(str(Res.string.link_via_relay)).assertDoesNotExist()
        composeRule.onAllNodesWithTag("settings.unpair").assertCountEquals(0)
        composeRule.onAllNodesWithTag("settings.rescan").assertCountEquals(0)
        composeRule.onNodeWithTag("settings.scan").performClick()
        assertEquals(1, pairing)
    }

    @Test
    fun aPairedComputerThatIsStillConnectingSaysSo() {
        val connecting = paired.copy(link = LinkSnapshot(LinkStatus.Connecting))
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                SettingsScreen(connecting, ThemeMode.Light, {}, {}, onUnpair = {}, onPair = {}, onBack = {})
            }
        }
        composeRule.onNodeWithText(str(Res.string.link_connecting)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.link_live)).assertDoesNotExist()
        composeRule.onNodeWithText(str(Res.string.link_via_relay)).assertDoesNotExist()
        composeRule.onAllNodesWithTag("settings.scan").assertCountEquals(0)
        composeRule.onNodeWithTag("settings.rescan").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("settings.unpair").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun aConnectedComputerWithoutALatencySampleShowsOnlyTheRoute() {
        val quiet = paired.copy(link = paired.link.copy(rttMs = null))
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                SettingsScreen(quiet, ThemeMode.Light, {}, {}, onUnpair = {}, onPair = {}, onBack = {})
            }
        }
        composeRule.onNodeWithText(str(Res.string.link_via_relay)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.link_latency, 42)).assertDoesNotExist()
        composeRule.onNodeWithText("—").assertDoesNotExist()
    }

    @Test
    fun offersOnlyPairingWhenNoComputerIsPaired() {
        var pairing = 0
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                SettingsScreen(MirrorState(ready = true), ThemeMode.Light, {}, {}, onUnpair = {}, onPair = { pairing += 1 }, onBack = {})
            }
        }
        composeRule.onNodeWithText(str(Res.string.work_unpaired_description)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.link_live)).assertDoesNotExist()
        composeRule.onNodeWithTag("settings.scan").performClick()
        assertEquals(1, pairing)
        composeRule.onAllNodesWithTag("settings.unpair").assertCountEquals(0)
        composeRule.onAllNodesWithTag("settings.computer").assertCountEquals(0)
    }
}
