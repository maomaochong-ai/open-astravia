package org.vetta.android.core.auth

import com.russhwolf.settings.Settings
import com.russhwolf.settings.set
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Access / Refresh token 持久化抽象。
 * 默认实现基于 multiplatform-settings（Android SharedPreferences）。
 */
interface TokenStore {
    val accessToken: String?
    val refreshToken: String?
    val tokens: StateFlow<StoredTokens?>

    fun save(accessToken: String, refreshToken: String)

    fun clear()

    fun snapshot(): StoredTokens? {
        val access = accessToken ?: return null
        val refresh = refreshToken ?: return null
        return StoredTokens(access, refresh)
    }
}

data class StoredTokens(
    val accessToken: String,
    val refreshToken: String,
)

class SettingsTokenStore(
    private val settings: Settings = Settings(),
    private val accessKey: String = KEY_ACCESS,
    private val refreshKey: String = KEY_REFRESH,
) : TokenStore {
    private val _tokens = MutableStateFlow(readSnapshot())
    override val tokens: StateFlow<StoredTokens?> = _tokens.asStateFlow()

    override val accessToken: String?
        get() = settings.getStringOrNull(accessKey)?.takeIf { it.isNotBlank() }

    override val refreshToken: String?
        get() = settings.getStringOrNull(refreshKey)?.takeIf { it.isNotBlank() }

    override fun save(accessToken: String, refreshToken: String) {
        settings[accessKey] = accessToken
        settings[refreshKey] = refreshToken
        _tokens.value = StoredTokens(accessToken, refreshToken)
    }

    override fun clear() {
        settings.remove(accessKey)
        settings.remove(refreshKey)
        _tokens.value = null
    }

    private fun readSnapshot(): StoredTokens? {
        val access = settings.getStringOrNull(accessKey)?.takeIf { it.isNotBlank() } ?: return null
        val refresh = settings.getStringOrNull(refreshKey)?.takeIf { it.isNotBlank() } ?: return null
        return StoredTokens(access, refresh)
    }

    companion object {
        const val KEY_ACCESS = "vetta.access_token"
        const val KEY_REFRESH = "vetta.refresh_token"
    }
}

/** 测试与无持久化场景使用。 */
class InMemoryTokenStore(
    accessToken: String? = null,
    refreshToken: String? = null,
) : TokenStore {
    private var access: String? = accessToken
    private var refresh: String? = refreshToken
    private val _tokens = MutableStateFlow(snapshot())
    override val tokens: StateFlow<StoredTokens?> = _tokens.asStateFlow()

    override val accessToken: String?
        get() = access

    override val refreshToken: String?
        get() = refresh

    override fun save(accessToken: String, refreshToken: String) {
        access = accessToken
        refresh = refreshToken
        _tokens.value = StoredTokens(accessToken, refreshToken)
    }

    override fun clear() {
        access = null
        refresh = null
        _tokens.value = null
    }
}
