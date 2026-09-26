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

    private val _backgroundLink = MutableStateFlow(settings.getBooleanOrNull(KEY_BACKGROUND_LINK) ?: false)

    /** Keeps the desktop link up while the app is in the background, to notify about sessions. */
    val backgroundLink: StateFlow<Boolean> = _backgroundLink.asStateFlow()

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

    fun setBackgroundLink(enabled: Boolean) {
        settings[KEY_BACKGROUND_LINK] = enabled
        _backgroundLink.value = enabled
    }

    companion object {
        private const val KEY_BACKGROUND_LINK = "vetta.prefs.background_link"
        private const val KEY_THEME = "vetta.prefs.theme"
        private const val KEY_REMOTE_IDENTITY = "vetta.prefs.remote_identity_v2"
    }
}
