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
import org.vetta.android.ui.auth.WelcomeScreen
import org.vetta.android.ui.i18n.Str
import org.vetta.android.ui.me.MeScreen
import org.vetta.android.ui.theme.VettaTheme
import kotlin.test.Test
import kotlin.test.assertTrue

@RunWith(AndroidJUnit4::class)
class EntryAndProfileScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun welcomePresentsLoginScanAndSkipAsRealActions() {
        var skipped = false
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                WelcomeScreen(
                    connecting = false,
                    error = null,
                    onLogin = {},
                    onScanPairing = {},
                    onSkip = { skipped = true },
                    onClearError = {},
                )
            }
        }

        composeRule.onNodeWithText(Str.getStarted).assertIsDisplayed()
        composeRule.onNodeWithText(Str.scanPairing).assertIsDisplayed()
        composeRule.onNodeWithText(Str.skipForNow).performClick()

        assertTrue(skipped)
    }

    @Test
    fun loggedOutProfileUsesReadableStateAndOffersLogin() {
        var loginRequested = false
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                MeScreen(
                    user = null,
                    subscription = null,
                    onlineDeviceCount = 0,
                    onOpenPlan = {},
                    onOpenSettings = {},
                    onOpenDevices = {},
                    onLogin = { loginRequested = true },
                    onLogout = {},
                )
            }
        }

        composeRule.onNodeWithText(Str.notLoggedIn).assertIsDisplayed()
        composeRule.onNodeWithText(Str.getStarted).performClick()

        assertTrue(loginRequested)
    }
}
