package org.vetta.android.app

import android.content.Context
import android.os.Build
import android.provider.Settings
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
import org.vetta.android.core.DeviceName
import org.vetta.android.core.nowEpochMs
import org.vetta.android.data.remote.SqliteSessionCache
import org.vetta.android.data.secure.KeystoreSecretStore
import org.vetta.android.domain.work.DesktopMirror
import org.vetta.android.domain.work.WidgetSummary
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
                deviceName = phoneName(context),
                onTurnEnd = { TurnEndHaptics.play(context) },
                createP2pTransport = NativeRemoteDesktopSessions::transport,
            )
        val container = AppContainer(preferences = preferences, scope = scope, mirror = DesktopMirror(platform, scope))
        // Started here too, for when the link service brings the process back without a screen.
        container.mirror.start()
        SessionNotifier.watch(context, container, scope)
        // The home screen widget follows the counts; while offline it says since when.
        scope.launch {
            var lastOnline: Long? = null
            container.mirror.state
                .map { state ->
                    if (state.online) lastOnline = nowEpochMs()
                    WidgetSummary.of(state, lastOnline ?: state.desktop?.lastSeenAt?.takeIf { it > 0 })
                }.distinctUntilChanged()
                .collect { SessionsWidget.update(context, it) }
        }
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

/** The name the owner gave this phone in the system settings, else maker and model. */
private fun phoneName(context: Context): String {
    val resolver = context.contentResolver
    val given =
        (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) runCatching { Settings.Global.getString(resolver, Settings.Global.DEVICE_NAME) }.getOrNull() else null)
            ?.takeIf { it.isNotBlank() }
            ?: runCatching { Settings.Secure.getString(resolver, "bluetooth_name") }.getOrNull()
    return DeviceName.pick(given, Build.MANUFACTURER, Build.MODEL)
}
