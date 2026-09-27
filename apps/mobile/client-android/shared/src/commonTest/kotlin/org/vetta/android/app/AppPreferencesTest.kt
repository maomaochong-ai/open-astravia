package org.vetta.android.app

import com.russhwolf.settings.MapSettings
import kotlin.test.Test
import kotlin.test.assertEquals
import org.vetta.android.domain.work.NotificationPrefs
import org.vetta.android.domain.work.QuietHours

class AppPreferencesTest {
    @Test
    fun newInstallUsesLightThemeByDefault() {
        assertEquals(ThemeMode.Light, AppPreferences(MapSettings()).themeMode.value)
    }

    @Test
    fun backgroundLinkIsOffUntilChosenAndPersists() {
        val settings = MapSettings()
        assertEquals(false, AppPreferences(settings).backgroundLink.value)
        AppPreferences(settings).setBackgroundLink(true)
        assertEquals(true, AppPreferences(settings).backgroundLink.value)
    }

    @Test
    fun themeChoicePersists() {
        val settings = MapSettings()
        AppPreferences(settings).setThemeMode(ThemeMode.Dark)
        assertEquals(ThemeMode.Dark, AppPreferences(settings).themeMode.value)
    }

    @Test
    fun notificationChoicesSurviveARelaunch() {
        val settings = MapSettings()
        assertEquals(NotificationPrefs(), AppPreferences(settings).notifications.value, "everything on by default")
        AppPreferences(settings).setNotifications { it.copy(finished = false, mutedProjects = setOf("/code/noisy"), quietHours = QuietHours()) }
        assertEquals(NotificationPrefs(finished = false, mutedProjects = setOf("/code/noisy"), quietHours = QuietHours()), AppPreferences(settings).notifications.value)
    }
}
