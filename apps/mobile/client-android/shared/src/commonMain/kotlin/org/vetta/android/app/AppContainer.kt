package org.vetta.android.app

import com.russhwolf.settings.Settings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.vetta.android.core.VettaClient
import org.vetta.android.core.VettaConfig
import org.vetta.android.core.auth.SettingsTokenStore
import org.vetta.android.core.auth.TokenStore
import org.vetta.android.data.remote.MemorySessionCache
import org.vetta.android.data.remote.SessionCache
import org.vetta.android.data.session.SettingsSessionStore
import org.vetta.android.domain.conversation.ConversationRouter
import org.vetta.android.domain.device.DesktopGateway
import org.vetta.android.domain.device.MirrorDesktopGateway
import org.vetta.android.domain.remote.connection.KtorWebSocketRemoteTransport
import org.vetta.android.domain.remote.connection.PlatformRemoteLogger
import org.vetta.android.domain.remote.pairing.SecretStore
import org.vetta.android.domain.remote.pairing.SettingsSecretStore
import org.vetta.android.domain.session.SessionStore
import org.vetta.android.domain.session.nowEpochMs
import org.vetta.android.domain.work.DesktopMirror
import org.vetta.android.domain.work.MirrorPlatform

/**
 * 进程级依赖容器。serverUrl 变更时重建 [VettaClient]，会话与 token 存储保持不变。
 * [scope] 绑定主线程：桌面镜像与它唯一的连接都在其上运行，状态无需加锁。
 */
class AppContainer(
    val preferences: AppPreferences = AppPreferences(),
    val tokenStore: TokenStore = SettingsTokenStore(),
    val sessionStore: SessionStore = SettingsSessionStore(),
    val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
    val mirror: DesktopMirror = DesktopMirror(defaultMirrorPlatform(preferences, scope), scope),
    val desktopGateway: DesktopGateway = MirrorDesktopGateway(mirror, scope),
) {
    private val unauthorizedSignal = MutableStateFlow(0L)
    val unauthorizedEpoch: StateFlow<Long> = unauthorizedSignal.asStateFlow()

    private var clientRef: VettaClient = createClient(preferences.serverUrl.value)

    val client: VettaClient
        get() = clientRef

    val conversationRouter = ConversationRouter(cloudStream = { modelId, messages -> client.chat.stream(modelId, messages) })

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
                    userAgent = "vetta-android/$APP_VERSION",
                ),
            tokenStore = tokenStore,
            onUnauthorized = { notifyUnauthorized() },
        )

    companion object {
        fun createDefault(): AppContainer = AppContainer()

        /**
         * The desktop mirror's device side. The platform entry point passes a persistent
         * [cache], Keystore-backed [secrets] and the device's name; previews fall back to plain storage.
         */
        fun defaultMirrorPlatform(
            preferences: AppPreferences,
            scope: CoroutineScope,
            cache: SessionCache = MemorySessionCache(),
            secrets: SecretStore = SettingsSecretStore(Settings()),
            deviceName: String = "Android",
            onTurnEnd: () -> Unit = {},
        ): MirrorPlatform =
            MirrorPlatform(
                settings = Settings(),
                secrets = secrets,
                cache = cache,
                createTransport = { url, pairingSecret -> KtorWebSocketRemoteTransport(url, pairingSecret, scope) },
                deviceName = deviceName,
                now = ::nowEpochMs,
                onTurnEnd = onTurnEnd,
                legacyIdentitySecret = preferences.legacyRemoteIdentitySecret,
                logger = PlatformRemoteLogger,
            )
    }
}
