package org.vetta.android.app

import com.russhwolf.settings.MapSettings
import kotlin.test.Test
import kotlin.test.assertEquals

class AppPreferencesTest {
    @Test
    fun newInstallUsesLightThemeByDefault() {
        assertEquals(ThemeMode.Light, AppPreferences(MapSettings()).themeMode.value)
    }

    @Test
    fun themeChoicePersists() {
        val settings = MapSettings()
        AppPreferences(settings).setThemeMode(ThemeMode.Dark)
        assertEquals(ThemeMode.Dark, AppPreferences(settings).themeMode.value)
    }
}
