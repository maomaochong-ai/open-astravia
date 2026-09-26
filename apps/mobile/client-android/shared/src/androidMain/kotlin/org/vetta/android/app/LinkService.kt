package org.vetta.android.app

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
        val container = AndroidAppContainer.get(this)
        val name = container.mirror.state.value.desktop?.desktopName.orEmpty()
        scope.launch {
            val notification = SessionNotifier.linkNotification(this@LinkService, name)
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING else 0
            runCatching { ServiceCompat.startForeground(this@LinkService, SessionNotifier.LINK_NOTIFICATION_ID, notification, type) }
                .onFailure { stopSelf() }
        }
        return START_STICKY
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
