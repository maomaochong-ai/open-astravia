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
    fun productPreferencesPersistBehaviorChoices() {
        val preferences = AppPreferences(MapSettings())

        preferences.setAutoResumeLastSession(false)
        preferences.setMotionEnabled(false)
        preferences.setConfirmBeforeDelete(false)

        assertEquals(false, preferences.autoResumeLastSession.value)
        assertEquals(false, preferences.motionEnabled.value)
        assertEquals(false, preferences.confirmBeforeDelete.value)
    }

    @Test
    fun booleanPreferencesReadExistingTypedValues() {
        val settings = MapSettings()
        settings.putBoolean("vetta.prefs.auto_resume", false)
        settings.putBoolean("vetta.prefs.motion_enabled", false)
        settings.putBoolean("vetta.prefs.confirm_delete", false)

        val preferences = AppPreferences(settings)

        assertEquals(false, preferences.autoResumeLastSession.value)
        assertEquals(false, preferences.motionEnabled.value)
        assertEquals(false, preferences.confirmBeforeDelete.value)
    }

    @Test
    fun booleanPreferencesStillReadLegacyStringValues() {
        val settings = MapSettings()
        settings.putString("vetta.prefs.auto_resume", "false")

        assertEquals(false, AppPreferences(settings).autoResumeLastSession.value)
    }
}
