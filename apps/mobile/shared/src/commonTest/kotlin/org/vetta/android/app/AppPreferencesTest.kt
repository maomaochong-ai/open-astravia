package org.vetta.android.app

import com.russhwolf.settings.MapSettings
import kotlin.test.Test
import kotlin.test.assertEquals

class AppPreferencesTest {
    @Test
    fun newInstallUsesLightThemeByDefault() {
        assertEquals(ThemeMode.Light, AppPreferences(MapSettings()).themeMode.value)
    }
}
