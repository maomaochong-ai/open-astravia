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

/**
 * 应用级偏好：服务器、主题、上次会话/模型和本地交互策略。
 * 与 TokenStore 分离，避免鉴权与产品偏好耦合。
 */
class AppPreferences(
    private val settings: Settings = Settings(),
) {
    private val _serverUrl = MutableStateFlow(readServerUrl())
    val serverUrl: StateFlow<String> = _serverUrl.asStateFlow()

    private val _themeMode = MutableStateFlow(ThemeMode.fromStorage(settings.getStringOrNull(KEY_THEME)))
    val themeMode: StateFlow<ThemeMode> = _themeMode.asStateFlow()

    private val _autoResumeLastSession = MutableStateFlow(readBoolean(KEY_AUTO_RESUME, true))
    val autoResumeLastSession: StateFlow<Boolean> = _autoResumeLastSession.asStateFlow()

    private val _motionEnabled = MutableStateFlow(readBoolean(KEY_MOTION_ENABLED, true))
    val motionEnabled: StateFlow<Boolean> = _motionEnabled.asStateFlow()

    private val _confirmBeforeDelete = MutableStateFlow(readBoolean(KEY_CONFIRM_DELETE, true))
    val confirmBeforeDelete: StateFlow<Boolean> = _confirmBeforeDelete.asStateFlow()

    var lastSessionId: String?
        get() = settings.getStringOrNull(KEY_LAST_SESSION)?.takeIf { it.isNotBlank() }
        set(value) {
            if (value.isNullOrBlank()) settings.remove(KEY_LAST_SESSION) else settings[KEY_LAST_SESSION] = value
        }

    var lastModelId: String?
        get() = settings.getStringOrNull(KEY_LAST_MODEL)?.takeIf { it.isNotBlank() }
        set(value) {
            if (value.isNullOrBlank()) settings.remove(KEY_LAST_MODEL) else settings[KEY_LAST_MODEL] = value
        }

    var remoteResumeSecret: String?
        get() = settings.getStringOrNull(KEY_REMOTE_RESUME)?.takeIf { it.isNotBlank() }
        set(value) {
            if (value.isNullOrBlank()) settings.remove(KEY_REMOTE_RESUME) else settings[KEY_REMOTE_RESUME] = value
        }

    var remotePairingId: String?
        get() = settings.getStringOrNull(KEY_REMOTE_PAIRING_ID)?.takeIf { it.isNotBlank() }
        set(value) {
            if (value.isNullOrBlank()) settings.remove(KEY_REMOTE_PAIRING_ID) else settings[KEY_REMOTE_PAIRING_ID] = value
        }

    fun setServerUrl(url: String) {
        val normalized = url.trim().trimEnd('/')
        require(normalized.isNotBlank()) { "serverUrl blank" }
        settings[KEY_SERVER_URL] = normalized
        _serverUrl.value = normalized
    }

    fun setThemeMode(mode: ThemeMode) {
        settings[KEY_THEME] = mode.name
        _themeMode.value = mode
    }

    fun setAutoResumeLastSession(enabled: Boolean) {
        settings[KEY_AUTO_RESUME] = enabled
        _autoResumeLastSession.value = enabled
    }

    fun setMotionEnabled(enabled: Boolean) {
        settings[KEY_MOTION_ENABLED] = enabled
        _motionEnabled.value = enabled
    }

    fun setConfirmBeforeDelete(enabled: Boolean) {
        settings[KEY_CONFIRM_DELETE] = enabled
        _confirmBeforeDelete.value = enabled
    }

    private fun readBoolean(key: String, default: Boolean): Boolean =
        runCatching { settings.getBooleanOrNull(key) }.getOrNull()
            ?: runCatching { settings.getStringOrNull(key)?.toBooleanStrictOrNull() }.getOrNull()
            ?: default

    private fun readServerUrl(): String =
        settings.getStringOrNull(KEY_SERVER_URL)?.takeIf { it.isNotBlank() } ?: DEFAULT_SERVER_URL

    companion object {
        /** 与 desktop `.env.development` 同源默认，可在设置中覆盖。 */
        const val DEFAULT_SERVER_URL = "https://api.openvetta.com/api/v1"

        private const val KEY_SERVER_URL = "vetta.prefs.server_url"
        private const val KEY_THEME = "vetta.prefs.theme"
        private const val KEY_AUTO_RESUME = "vetta.prefs.auto_resume"
        private const val KEY_MOTION_ENABLED = "vetta.prefs.motion_enabled"
        private const val KEY_CONFIRM_DELETE = "vetta.prefs.confirm_delete"
        private const val KEY_LAST_SESSION = "vetta.prefs.last_session"
        private const val KEY_LAST_MODEL = "vetta.prefs.last_model"
        private const val KEY_REMOTE_RESUME = "vetta.prefs.remote_resume"
        private const val KEY_REMOTE_PAIRING_ID = "vetta.prefs.remote_pairing_id"
    }
}
