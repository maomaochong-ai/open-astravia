package org.vetta.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.runner.RunWith
import org.vetta.android.app.ThemeMode
import org.vetta.android.core.model.User
import org.vetta.android.ui.auth.WelcomeScreen
import org.vetta.android.ui.auth.LoginScreen
import org.vetta.android.ui.i18n.Str
import org.vetta.android.ui.me.MeScreen
import org.vetta.android.ui.me.AboutScreen
import org.vetta.android.ui.me.PlanScreen
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
                    onOpenAbout = {},
                    onLogin = { loginRequested = true },
                    onLogout = {},
                )
            }
        }

        composeRule.onNodeWithText(Str.notLoggedIn).assertIsDisplayed()
        composeRule.onNodeWithText(Str.getStarted).performClick()

        assertTrue(loginRequested)
    }

    @Test
    fun profileNavigationRowsOpenTheirDestinations() {
        val opened = mutableListOf<String>()
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                MeScreen(
                    user = null,
                    subscription = null,
                    onlineDeviceCount = 0,
                    onOpenPlan = { opened += "plan" },
                    onOpenSettings = { opened += "settings" },
                    onOpenDevices = { opened += "devices" },
                    onOpenAbout = { opened += "about" },
                    onLogin = {},
                    onLogout = {},
                )
            }
        }

        composeRule.onNodeWithText(Str.connectedDevices).performClick()
        composeRule.onNodeWithText(Str.generalSettings).performClick()
        composeRule.onNodeWithText(Str.loginToViewPlan).performClick()
        composeRule.onNodeWithText(Str.aboutUs).performClick()

        assertTrue(opened == listOf("devices", "settings", "plan", "about"))
    }

    @Test
    fun aboutScreenShowsProductIdentity() {
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                AboutScreen(onBack = {})
            }
        }

        composeRule.onNodeWithText(Str.aboutVetta).assertIsDisplayed()
        composeRule.onNodeWithText(Str.versionNumber).assertIsDisplayed()
        composeRule.onNodeWithText(Str.aboutDescription).assertIsDisplayed()
    }

    @Test
    fun aboutDocumentsOpenReadableDialogs() {
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                AboutScreen(onBack = {})
            }
        }

        composeRule.onNodeWithText(Str.openSourceLicenses).performClick()
        composeRule.onNodeWithText(Str.openSourceLicensesBody).assertIsDisplayed()
        composeRule.onNodeWithText(Str.close).performClick()

        composeRule.onNodeWithText(Str.privacyPolicy).performClick()
        composeRule.onNodeWithText(Str.privacyPolicyBody).assertIsDisplayed()
    }

    @Test
    fun aboutBackButtonCallsNavigationCallback() {
        var navigatedBack = false
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                AboutScreen(onBack = { navigatedBack = true })
            }
        }

        composeRule.onNodeWithContentDescription(Str.back).performClick()
        assertTrue(navigatedBack)
    }

    @Test
    fun loginFormSubmitsEnteredCredentials() {
        var credentials: Pair<String, String>? = null
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                LoginScreen(
                    loading = false,
                    error = null,
                    loginModeEmail = true,
                    passwordVisible = false,
                    onToggleMode = {},
                    onTogglePassword = {},
                    onLogin = { account, password -> credentials = account to password },
                    onClearError = {},
                    onBack = {},
                )
            }
        }

        composeRule.onNodeWithText(Str.email).performTextInput("user@example.test")
        composeRule.onNodeWithText(Str.password).performTextInput("password")
        composeRule.onNodeWithText(Str.loginAction).performClick()

        assertTrue(credentials == "user@example.test" to "password")
    }

    @Test
    fun loginModeAndPasswordVisibilityUseCallbacks() {
        val modeChanges = mutableListOf<Boolean>()
        val visibilityChanges = mutableListOf<Boolean>()
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                LoginScreen(
                    loading = false,
                    error = null,
                    loginModeEmail = true,
                    passwordVisible = false,
                    onToggleMode = { modeChanges += it },
                    onTogglePassword = { visibilityChanges += it },
                    onLogin = { _, _ -> },
                    onClearError = {},
                    onBack = {},
                )
            }
        }

        composeRule.onNodeWithContentDescription(Str.showPassword).performClick()
        composeRule.onNodeWithText(Str.useAccountLogin).performClick()

        assertTrue(visibilityChanges == listOf(true))
        assertTrue(modeChanges == listOf(false))
    }

    @Test
    fun loggedOutPlanOffersLoginAction() {
        var loginRequested = false
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                PlanScreen(
                    subscription = null,
                    loggedIn = false,
                    onBack = {},
                    onRefresh = {},
                    onLogin = { loginRequested = true },
                )
            }
        }

        composeRule.onNodeWithText(Str.loginToViewPlan).assertIsDisplayed()
        composeRule.onNodeWithText(Str.getStarted).performClick()
        assertTrue(loginRequested)
    }

    @Test
    fun loggedInPlanRefreshUsesRetryAction() {
        var refreshed = false
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                PlanScreen(
                    subscription = null,
                    loggedIn = true,
                    onBack = {},
                    onRefresh = { refreshed = true },
                    onLogin = {},
                )
            }
        }

        composeRule.onNodeWithContentDescription(Str.actionRetry).performClick()
        assertTrue(refreshed)
    }

    @Test
    fun logoutDialogCanClearLocalSessions() {
        var clearLocal: Boolean? = null
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                MeScreen(
                    user = User(id = 1, username = "tester", nickname = "Tester"),
                    subscription = null,
                    onlineDeviceCount = 0,
                    onOpenPlan = {},
                    onOpenSettings = {},
                    onOpenDevices = {},
                    onOpenAbout = {},
                    onLogin = {},
                    onLogout = { clearLocal = it },
                )
            }
        }

        composeRule.onNodeWithText(Str.logout).performClick()
        composeRule.onNodeWithText(Str.logoutConfirm).assertIsDisplayed()
        composeRule.onNodeWithText(Str.logoutAndClear).performClick()
        assertTrue(clearLocal == true)
    }

    @Test
    fun logoutDialogCanPreserveLocalSessions() {
        var clearLocal: Boolean? = null
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                MeScreen(
                    user = User(id = 1, username = "tester", nickname = "Tester"),
                    subscription = null,
                    onlineDeviceCount = 0,
                    onOpenPlan = {},
                    onOpenSettings = {},
                    onOpenDevices = {},
                    onOpenAbout = {},
                    onLogin = {},
                    onLogout = { clearLocal = it },
                )
            }
        }

        composeRule.onNodeWithText(Str.logout).performClick()
        composeRule.onNodeWithText(Str.logoutConfirm).assertIsDisplayed()
        composeRule.onNodeWithText(Str.confirmLogout).performClick()

        assertTrue(clearLocal == false)
    }
}
