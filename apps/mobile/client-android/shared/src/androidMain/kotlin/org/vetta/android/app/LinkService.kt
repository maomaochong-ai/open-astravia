package org.vetta.android.app

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Keeps the process, and with it the desktop link, alive while the app is in the
 * background, so session notifications can arrive. Android asks that such work be shown:
 * it holds a quiet ongoing notification naming the computer.
 */
class LinkService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Android allows only a few seconds to go foreground, and the localized notice can take
        // longer to load on a cold start: a plain one goes up at once, the real one replaces it.
        if (!goForeground(SessionNotifier.plainLinkNotification(this))) {
            stopSelf()
            return START_NOT_STICKY
        }
        val container = AndroidAppContainer.get(this)
        val name = container.mirror.state.value.desktop?.desktopName.orEmpty()
        scope.launch { goForeground(SessionNotifier.linkNotification(this@LinkService, name)) }
        return START_STICKY
    }

    private fun goForeground(notification: Notification): Boolean {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING else 0
        return runCatching { ServiceCompat.startForeground(this, SessionNotifier.LINK_NOTIFICATION_ID, notification, type) }.isSuccess
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        fun start(context: Context) {
            runCatching { ContextCompat.startForegroundService(context, Intent(context, LinkService::class.java)) }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, LinkService::class.java))
        }
    }
}
