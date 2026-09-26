package org.vetta.android.app

import com.russhwolf.settings.Settings
import com.russhwolf.settings.set
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class ThemeMode {
    System,
    Light,
    Dark,
    ;

    companion object {
        fun fromStorage(value: String?): ThemeMode =
            entries.firstOrNull { it.name == value } ?: Light
    }
}

/** The app's own preferences; the desktop link keeps its settings in the mirror. */
class AppPreferences(
    private val settings: Settings = Settings(),
) {
    private val _themeMode = MutableStateFlow(ThemeMode.fromStorage(settings.getStringOrNull(KEY_THEME)))
    val themeMode: StateFlow<ThemeMode> = _themeMode.asStateFlow()

    /**
     * The phone identity builds before the desktop mirror kept here; read once so
     * [org.vetta.android.domain.remote.pairing.PairingStore] can adopt it.
     */
    val legacyRemoteIdentitySecret: String?
        get() = settings.getStringOrNull(KEY_REMOTE_IDENTITY)?.takeIf { it.isNotBlank() }

    fun setThemeMode(mode: ThemeMode) {
        settings[KEY_THEME] = mode.name
        _themeMode.value = mode
    }

    companion object {
        private const val KEY_THEME = "vetta.prefs.theme"
        private const val KEY_REMOTE_IDENTITY = "vetta.prefs.remote_identity_v2"
    }
}
