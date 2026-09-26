package org.vetta.android.app

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.sqlite.driver.AndroidSQLiteDriver
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import org.vetta.android.data.remote.SqliteSessionCache
import org.vetta.android.data.secure.KeystoreSecretStore
import org.vetta.android.domain.work.DesktopMirror
import org.vetta.android.ui.remote.NativeRemoteDesktopSessions

/**
 * The process-wide container. One per process, not per activity: the desktop
 * mirror holds the only connection to the paired desktop and must outlive
 * configuration changes.
 */
object AndroidAppContainer {
    @Volatile
    private var instance: AppContainer? = null

    fun get(context: Context): AppContainer =
        instance ?: synchronized(this) {
            instance ?: create(context.applicationContext).also { instance = it }
        }

    private fun create(context: Context): AppContainer {
        NativeRemoteDesktopSessions.configure(context)
        val preferences = AppPreferences()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        val cachePath = context.getDatabasePath(CACHE_FILE).also { it.parentFile?.mkdirs() }.path
        val platform =
            AppContainer.defaultMirrorPlatform(
                preferences = preferences,
                scope = scope,
                cache = SqliteSessionCache(AndroidSQLiteDriver(), cachePath),
                secrets = KeystoreSecretStore(context),
                deviceName = Build.MODEL?.takeIf { it.isNotBlank() } ?: "Android",
                onTurnEnd = { TurnEndHaptics.play(context) },
                createP2pTransport = NativeRemoteDesktopSessions::transport,
            )
        val container = AppContainer(preferences = preferences, scope = scope, mirror = DesktopMirror(platform, scope))
        // Started here too, for when the link service brings the process back without a screen.
        container.mirror.start()
        SessionNotifier.watch(context, container, scope)
        // The link service runs while the user wants news in the background and a desktop is
        // paired; it is started while the app is on screen, which Android requires.
        scope.launch {
            combine(preferences.backgroundLink, container.mirror.state.map { it.paired }, container.visible) { wanted, paired, visible ->
                when {
                    !wanted || !paired -> false
                    visible -> true
                    else -> null
                }
            }.distinctUntilChanged().collect { run ->
                when (run) {
                    true -> LinkService.start(context)
                    false -> LinkService.stop(context)
                    null -> Unit
                }
            }
        }
        return container
    }

    private const val CACHE_FILE = "vetta-cache.sqlite"
}

/** A short buzz when the desktop finishes a turn, if the phone can vibrate. */
private object TurnEndHaptics {
    fun play(context: Context) {
        val vibrator =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                context.getSystemService(VibratorManager::class.java)?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }
        if (vibrator?.hasVibrator() != true) return
        vibrator.vibrate(VibrationEffect.createOneShot(40, VibrationEffect.DEFAULT_AMPLITUDE))
    }
}
