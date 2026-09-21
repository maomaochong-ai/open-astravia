package org.vetta.android.core

import io.ktor.client.HttpClient
import org.vetta.android.core.api.VettaApi
import org.vetta.android.core.auth.SettingsTokenStore
import org.vetta.android.core.auth.TokenStore
import org.vetta.android.core.net.UnauthorizedHandler
import org.vetta.android.core.net.TokenRefresher
import org.vetta.android.core.net.createBareHttpClient
import org.vetta.android.core.net.createVettaHttpClient

/**
 * Vetta 移动端底层入口：鉴权、模型清单、订阅、Gateway 流式对话。
 *
 * ```kotlin
 * val client = VettaClient.create(
 *   VettaConfig(serverUrl = "https://example.com/api/v1"),
 * )
 * client.auth.loginWithEmailPassword(email, password)
 * client.chat.stream(modelId, messages).collect { ... }
 * client.close()
 * ```
 */
class VettaClient private constructor(
    val config: VettaConfig,
    val tokenStore: TokenStore,
    val auth: AuthRepository,
    val models: ModelsRepository,
    val subscription: SubscriptionRepository,
    val chat: ChatRepository,
    private val httpClient: HttpClient,
    private val bareHttpClient: HttpClient,
) {
    fun close() {
        httpClient.close()
        bareHttpClient.close()
    }

    companion object {
        fun create(
            config: VettaConfig,
            tokenStore: TokenStore = SettingsTokenStore(),
            onUnauthorized: UnauthorizedHandler? = null,
        ): VettaClient {
            val bare = createBareHttpClient(config)

            // TokenRefresher / VettaApi 互相引用：先建 refresher 占位，再注入 api.refresh
            lateinit var api: VettaApi
            val refresher =
                TokenRefresher(
                    tokenStore = tokenStore,
                    refreshAction = { refreshToken -> api.refreshTokens(refreshToken) },
                    onUnauthorized = onUnauthorized,
                )
            val client = createVettaHttpClient(config, tokenStore, refresher)
            api = VettaApi(client, bare, config, tokenStore)

            return VettaClient(
                config = config,
                tokenStore = tokenStore,
                auth = AuthRepository(api, tokenStore, refresher),
                models = ModelsRepository(api),
                subscription = SubscriptionRepository(api),
                chat = ChatRepository(api),
                httpClient = client,
                bareHttpClient = bare,
            )
        }
    }
}
