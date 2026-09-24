package org.vetta.android.ui.work

import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.runner.RunWith
import org.vetta.android.app.ThemeMode
import org.vetta.android.resources.Res
import org.vetta.android.resources.pair_code_hint
import org.vetta.android.resources.pair_manual_invalid
import org.vetta.android.ui.str
import org.vetta.android.ui.theme.VettaTheme
import kotlin.test.Test
import kotlin.test.assertEquals

@RunWith(AndroidJUnit4::class)
class PairingDialogsTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun aTypedAddressIsCheckedBeforeItConnects() {
        val connected = mutableListOf<String>()
        composeRule.setContent {
            VettaTheme(themeMode = ThemeMode.Light) {
                PairingActions(connecting = false, onManual = { connected += it }) { Text("scan") }
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
    fun whilePairingOnlyASpinnerShows() {
        composeRule.setContent {
            VettaTheme(themeMode = ThemeMode.Light) {
                PairingActions(connecting = true, onManual = {}) { Text("scan") }
            }
        }
        composeRule.onNodeWithTag("pair.connecting").assertIsDisplayed()
        composeRule.onNodeWithTag("pair.manual").assertDoesNotExist()
        composeRule.onNodeWithText("scan").assertDoesNotExist()
    }

    @Test
    fun theApprovalStepShowsTheCodeAndCanBeCancelled() {
        var cancelled = false
        composeRule.setContent {
            VettaTheme(themeMode = ThemeMode.Light) {
                PairingApprovalDialog(verificationCode = "042917", onCancel = { cancelled = true })
            }
        }
        composeRule.onNodeWithTag("pair.code").assertIsDisplayed()
        composeRule.onNodeWithText("042917").assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.pair_code_hint)).assertIsDisplayed()
        composeRule.onNodeWithTag("pair.cancel").performClick()
        assertEquals(true, cancelled)
    }
}
