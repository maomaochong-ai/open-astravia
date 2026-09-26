package org.vetta.android.app

import com.russhwolf.settings.Settings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import org.vetta.android.core.nowEpochMs
import org.vetta.android.data.remote.MemorySessionCache
import org.vetta.android.data.remote.SessionCache
import org.vetta.android.domain.remote.connection.KtorWebSocketRemoteTransport
import org.vetta.android.domain.remote.connection.PlatformRemoteLogger
import org.vetta.android.domain.remote.link.P2pRemoteTransportFactory
import org.vetta.android.domain.remote.pairing.SecretStore
import org.vetta.android.domain.remote.pairing.SettingsSecretStore
import org.vetta.android.domain.work.DesktopMirror
import org.vetta.android.domain.work.MirrorPlatform

/**
 * The process-wide dependencies. [scope] is bound to the main thread: the desktop
 * mirror and its one link run on it, so their state needs no locking.
 */
class AppContainer(
    val preferences: AppPreferences = AppPreferences(),
    val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
    val mirror: DesktopMirror = DesktopMirror(defaultMirrorPlatform(preferences, scope), scope),
) {
    private val _visible = MutableStateFlow(false)

    /** Whether the app is on screen; notifications are only for when it is not. */
    val visible: StateFlow<Boolean> = _visible.asStateFlow()

    init {
        // The link rests in the background unless the user asked to be told about sessions there.
        scope.launch {
            combine(_visible, preferences.backgroundLink, mirror.state.map { it.paired }.distinctUntilChanged()) { shown, background, paired ->
                shown || (background && paired)
            }.distinctUntilChanged().collect(mirror::setActive)
        }
    }

    /** The app came on screen or went out of sight. */
    fun setVisible(value: Boolean) {
        _visible.value = value
    }

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
            createP2pTransport: P2pRemoteTransportFactory? = null,
        ): MirrorPlatform =
            MirrorPlatform(
                settings = Settings(),
                secrets = secrets,
                cache = cache,
                createTransport = { url, pairingSecret -> KtorWebSocketRemoteTransport(url, pairingSecret, scope) },
                createP2pTransport = createP2pTransport,
                deviceName = deviceName,
                now = ::nowEpochMs,
                onTurnEnd = onTurnEnd,
                legacyIdentitySecret = preferences.legacyRemoteIdentitySecret,
                logger = PlatformRemoteLogger,
            )
    }
}
