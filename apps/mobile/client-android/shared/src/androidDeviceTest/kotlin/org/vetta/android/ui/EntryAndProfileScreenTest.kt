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
import org.vetta.android.app.APP_VERSION
import org.vetta.android.app.ThemeMode
import org.vetta.android.core.model.User
import org.vetta.android.ui.auth.WelcomeScreen
import org.vetta.android.ui.auth.LoginScreen
import org.vetta.android.resources.Res
import org.vetta.android.resources.about_description
import org.vetta.android.resources.about_us
import org.vetta.android.resources.about_vetta
import org.vetta.android.resources.action_retry
import org.vetta.android.resources.back
import org.vetta.android.resources.close
import org.vetta.android.resources.confirm_logout
import org.vetta.android.resources.connected_devices
import org.vetta.android.resources.email
import org.vetta.android.resources.general_settings
import org.vetta.android.resources.get_started
import org.vetta.android.resources.login_action
import org.vetta.android.resources.login_to_view_plan
import org.vetta.android.resources.logout
import org.vetta.android.resources.logout_and_clear
import org.vetta.android.resources.logout_confirm
import org.vetta.android.resources.not_logged_in
import org.vetta.android.resources.open_source_licenses
import org.vetta.android.resources.open_source_licenses_body
import org.vetta.android.resources.password
import org.vetta.android.resources.privacy_policy
import org.vetta.android.resources.privacy_policy_body
import org.vetta.android.resources.scan_pairing
import org.vetta.android.resources.show_password
import org.vetta.android.resources.skip_for_now
import org.vetta.android.resources.use_account_login
import org.vetta.android.resources.version_number
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

        composeRule.onNodeWithText(str(Res.string.get_started)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.scan_pairing)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.skip_for_now)).performClick()

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

        composeRule.onNodeWithText(str(Res.string.not_logged_in)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.get_started)).performClick()

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

        composeRule.onNodeWithText(str(Res.string.connected_devices)).performClick()
        composeRule.onNodeWithText(str(Res.string.general_settings)).performClick()
        composeRule.onNodeWithText(str(Res.string.login_to_view_plan)).performClick()
        composeRule.onNodeWithText(str(Res.string.about_us)).performClick()

        assertTrue(opened == listOf("devices", "settings", "plan", "about"))
    }

    @Test
    fun aboutScreenShowsProductIdentity() {
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                AboutScreen(onBack = {})
            }
        }

        composeRule.onNodeWithText(str(Res.string.about_vetta)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.version_number, APP_VERSION)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.about_description)).assertIsDisplayed()
    }

    @Test
    fun aboutDocumentsOpenReadableDialogs() {
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                AboutScreen(onBack = {})
            }
        }

        composeRule.onNodeWithText(str(Res.string.open_source_licenses)).performClick()
        composeRule.onNodeWithText(str(Res.string.open_source_licenses_body)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.close)).performClick()

        composeRule.onNodeWithText(str(Res.string.privacy_policy)).performClick()
        composeRule.onNodeWithText(str(Res.string.privacy_policy_body)).assertIsDisplayed()
    }

    @Test
    fun aboutBackButtonCallsNavigationCallback() {
        var navigatedBack = false
        composeRule.setContent {
            VettaTheme(ThemeMode.Light) {
                AboutScreen(onBack = { navigatedBack = true })
            }
        }

        composeRule.onNodeWithContentDescription(str(Res.string.back)).performClick()
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

        composeRule.onNodeWithText(str(Res.string.email)).performTextInput("user@example.test")
        composeRule.onNodeWithText(str(Res.string.password)).performTextInput("password")
        composeRule.onNodeWithText(str(Res.string.login_action)).performClick()

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

        composeRule.onNodeWithContentDescription(str(Res.string.show_password)).performClick()
        composeRule.onNodeWithText(str(Res.string.use_account_login)).performClick()

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

        composeRule.onNodeWithText(str(Res.string.login_to_view_plan)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.get_started)).performClick()
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

        composeRule.onNodeWithContentDescription(str(Res.string.action_retry)).performClick()
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

        composeRule.onNodeWithText(str(Res.string.logout)).performClick()
        composeRule.onNodeWithText(str(Res.string.logout_confirm)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.logout_and_clear)).performClick()
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

        composeRule.onNodeWithText(str(Res.string.logout)).performClick()
        composeRule.onNodeWithText(str(Res.string.logout_confirm)).assertIsDisplayed()
        composeRule.onNodeWithText(str(Res.string.confirm_logout)).performClick()

        assertTrue(clearLocal == false)
    }
}
