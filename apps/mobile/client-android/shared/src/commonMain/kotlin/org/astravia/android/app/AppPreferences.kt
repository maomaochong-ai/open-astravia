package org.astravia.android.app

import com.russhwolf.settings.Settings
import com.russhwolf.settings.set
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import org.astravia.android.domain.work.NotificationPrefs

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

    private val _notifications =
        MutableStateFlow(
            settings.getStringOrNull(KEY_NOTIFICATIONS)
                ?.let { runCatching { json.decodeFromString(NotificationPrefs.serializer(), it) }.getOrNull() }
                ?: NotificationPrefs(),
        )

    /** Which session news becomes a notification, and when it arrives quietly. */
    val notifications: StateFlow<NotificationPrefs> = _notifications.asStateFlow()

    /**
     * The phone identity builds before the desktop mirror kept here; read once so
     * [org.astravia.android.domain.remote.pairing.PairingStore] can adopt it.
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

    fun setNotifications(update: (NotificationPrefs) -> NotificationPrefs) {
        val next = update(_notifications.value)
        settings[KEY_NOTIFICATIONS] = json.encodeToString(NotificationPrefs.serializer(), next)
        _notifications.value = next
    }

    companion object {
        private const val KEY_NOTIFICATIONS = "astravia.prefs.notifications"
        // Every field is written, so a later change of a default never changes a saved choice.
        private val json =
            Json {
                ignoreUnknownKeys = true
                encodeDefaults = true
            }
        private const val KEY_BACKGROUND_LINK = "astravia.prefs.background_link"
        private const val KEY_THEME = "astravia.prefs.theme"
        private const val KEY_REMOTE_IDENTITY = "astravia.prefs.remote_identity_v2"
    }
}
