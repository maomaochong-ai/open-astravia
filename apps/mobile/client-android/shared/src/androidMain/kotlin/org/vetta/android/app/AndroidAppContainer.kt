package org.vetta.android.app

import android.content.Context
import android.os.Build
import androidx.sqlite.driver.AndroidSQLiteDriver
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.vetta.android.data.remote.SqliteSessionCache
import org.vetta.android.domain.work.DesktopMirror

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
        val preferences = AppPreferences()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        val cachePath = context.getDatabasePath(CACHE_FILE).also { it.parentFile?.mkdirs() }.path
        val platform =
            AppContainer.defaultMirrorPlatform(
                preferences = preferences,
                scope = scope,
                cache = SqliteSessionCache(AndroidSQLiteDriver(), cachePath),
                deviceName = Build.MODEL?.takeIf { it.isNotBlank() } ?: "Android",
            )
        return AppContainer(preferences = preferences, scope = scope, mirror = DesktopMirror(platform, scope))
    }

    private const val CACHE_FILE = "vetta-cache.sqlite"
}
