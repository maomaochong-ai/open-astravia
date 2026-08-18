package org.vetta.android.app

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.vetta.android.core.VettaClient
import org.vetta.android.core.VettaConfig
import org.vetta.android.core.auth.SettingsTokenStore
import org.vetta.android.core.auth.TokenStore
import org.vetta.android.data.session.SettingsSessionStore
import org.vetta.android.domain.session.SessionStore

/**
 * 进程级依赖容器。serverUrl 变更时重建 [VettaClient]，会话与 token 存储保持不变。
 */
class AppContainer(
    val preferences: AppPreferences = AppPreferences(),
    val tokenStore: TokenStore = SettingsTokenStore(),
    val sessionStore: SessionStore = SettingsSessionStore(),
) {
    private val unauthorizedSignal = MutableStateFlow(0L)
    val unauthorizedEpoch: StateFlow<Long> = unauthorizedSignal.asStateFlow()

    private var clientRef: VettaClient = createClient(preferences.serverUrl.value)

    val client: VettaClient
        get() = clientRef

    fun notifyUnauthorized() {
        unauthorizedSignal.value = unauthorizedSignal.value + 1
    }

    @Synchronized
    fun recreateClient(serverUrl: String = preferences.serverUrl.value): VettaClient {
        runCatching { clientRef.close() }
        clientRef = createClient(serverUrl)
        return clientRef
    }

    private fun createClient(serverUrl: String): VettaClient =
        VettaClient.create(
            config =
                VettaConfig(
                    serverUrl = serverUrl,
                    userAgent = "vetta-android/0.1.0",
                ),
            tokenStore = tokenStore,
            onUnauthorized = { notifyUnauthorized() },
        )

    companion object {
        fun createDefault(): AppContainer = AppContainer()
    }
}
