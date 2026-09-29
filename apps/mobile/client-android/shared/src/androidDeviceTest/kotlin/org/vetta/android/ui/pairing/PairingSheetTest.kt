package org.vetta.android.ui.pairing

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlin.test.Test
import kotlin.test.assertEquals
import org.junit.Rule
import org.junit.runner.RunWith
import org.vetta.android.app.ThemeMode
import org.vetta.android.domain.remote.pairing.InviteLookup
import org.vetta.android.domain.remote.pairing.PairingFailure
import org.vetta.android.domain.remote.pairing.PairingPhase
import org.vetta.android.domain.remote.pairing.PairingVia
import org.vetta.android.resources.Res
import org.vetta.android.resources.pair_code_hint
import org.vetta.android.resources.pair_connecting
import org.vetta.android.resources.pair_failed_rejected
import org.vetta.android.resources.pair_invite_not_found
import org.vetta.android.resources.pair_manual_invalid
import org.vetta.android.ui.AppViewModel
import org.vetta.android.ui.PairingError
import org.vetta.android.ui.str
import org.vetta.android.ui.theme.VettaTheme

@RunWith(AndroidJUnit4::class)
class PairingSheetTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun aTypedAddressIsCheckedBeforeItConnects() {
        val connected = mutableListOf<String>()
        composeRule.setContent {
            VettaTheme(themeMode = ThemeMode.Light) {
                PairingSheet(PairingPhase.Idle, connecting = false, error = null, onScanned = {}, onManual = { connected += it }, onCancelPairing = {}, onDismiss = {})
            }
        }
        composeRule.onNodeWithTag("pair.manual").performClick()
        composeRule.onNodeWithTag("pair.endpoint").performTextInput("192.168.1.20")
        composeRule.onNodeWithTag("pair.connect").performClick()
        composeRule.onNodeWithText(str(Res.string.pair_manual_invalid)).assertIsDisplayed()
        assertEquals(emptyList(), connected)

        composeRule.onNodeWithTag("pair.endpoint").performTextInput(":43117 ")
        composeRule.onNodeWithTag("pair.connect").performClick()
        composeRule.waitForIdle()
        assertEquals(listOf("192.168.1.20:43117"), connected)
        composeRule.onNodeWithTag("pair.endpoint").assertDoesNotExist()
    }

    @Test
    fun aFullCodeMovesOnAndAFullPasswordConnects() {
        val connected = mutableListOf<Triple<String, String, String?>>()
        composeRule.setContent {
            VettaTheme(themeMode = ThemeMode.Light) {
                PairingSheet(
                    PairingPhase.Idle,
                    connecting = false,
                    error = null,
                    onScanned = {},
                    onManual = {},
                    onCancelPairing = {},
                    onDismiss = {},
                    onCode = { code, password, relay -> connected += Triple(code, password, relay) },
                )
            }
        }
        composeRule.onNodeWithTag("pair.invite").performClick()
        composeRule.onNodeWithTag("pair.invite.code").performTextInput("k7q2-9mxd")
        composeRule.waitForIdle()
        composeRule.onNodeWithText("K7Q2-9MXD").assertIsDisplayed()
        composeRule.onNodeWithTag("pair.invite.password").performTextInput("48291a3")
        composeRule.waitForIdle()
        assertEquals(listOf(Triple("K7Q29MXD", "482913", null as String?)), connected, "letters in the password are dropped as typed")
    }

    @Test
    fun anUnknownCodeGoesBackToTheCodeStepAndSaysWhy() {
        var connecting by mutableStateOf(false)
        var error by mutableStateOf<PairingError?>(null)
        composeRule.setContent {
            VettaTheme(themeMode = ThemeMode.Light) {
                InvitePairScreen(
                    connecting = connecting,
                    error = error,
                    failure = if (error != null) InviteLookup.NotFound else null,
                    onConnect = { _, _, _ -> connecting = true },
                    onDismiss = {},
                )
            }
        }
        composeRule.onNodeWithTag("pair.invite.code").performTextInput("K7Q29MXD")
        composeRule.onNodeWithTag("pair.invite.password").performTextInput("482913")
        composeRule.waitForIdle()
        error = AppViewModel.inviteError(InviteLookup.NotFound)
        connecting = false
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("pair.invite.error").assertTextEquals(str(Res.string.pair_invite_not_found))
        composeRule.onNodeWithTag("pair.invite.next").assertExists()
    }

    @Test
    fun showsThatItIsConnecting() {
        composeRule.setContent {
            VettaTheme(themeMode = ThemeMode.Light) {
                PairingSheet(
                    PairingPhase.Connecting(PairingVia.Lan),
                    connecting = true,
                    error = null,
                    onScanned = {},
                    onManual = {},
                    onCancelPairing = {},
                    onDismiss = {},
                )
            }
        }
        composeRule.onNodeWithText(str(Res.string.pair_connecting)).assertIsDisplayed()
    }

    @Test
    fun aFailureIsShownOnTheSheet() {
        composeRule.setContent {
            VettaTheme(themeMode = ThemeMode.Light) {
                PairingSheet(
                    PairingPhase.Failed(PairingFailure.Rejected),
                    connecting = false,
                    error = AppViewModel.pairingError(PairingFailure.Rejected),
                    onScanned = {},
                    onManual = {},
                    onCancelPairing = {},
                    onDismiss = {},
                )
            }
        }
        composeRule.onNodeWithTag("pair.error").assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.pair_failed_rejected)).assertIsDisplayed()
    }

    @Test
    fun theApprovalStepShowsTheCodeAndCanBeCancelled() {
        var cancelled = false
        composeRule.setContent {
            VettaTheme(themeMode = ThemeMode.Light) {
                PairingSheet(
                    PairingPhase.AwaitingApproval("042917", "MacBook Pro"),
                    connecting = true,
                    error = null,
                    onScanned = {},
                    onManual = {},
                    onCancelPairing = { cancelled = true },
                    onDismiss = {},
                )
            }
        }
        composeRule.onNodeWithTag("pair.code").assertIsDisplayed()
        composeRule.onNodeWithText("042917").assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.pair_code_hint)).assertIsDisplayed()
        composeRule.onNodeWithTag("pair.cancel").performClick()
        assertEquals(true, cancelled)
    }
}
