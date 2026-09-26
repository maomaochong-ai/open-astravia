package org.vetta.android.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.getString
import org.vetta.android.core.nowEpochMs
import org.vetta.android.domain.remote.RemoteQuestionRequest
import org.vetta.android.domain.remote.connection.PlatformRemoteLogger
import org.vetta.android.domain.work.HeldAlert
import org.vetta.android.domain.work.QuickReply
import org.vetta.android.domain.work.SessionAlert
import org.vetta.android.domain.work.SessionAlerts
import org.vetta.android.resources.Res
import org.vetta.android.resources.notify_channel_link
import org.vetta.android.resources.notify_channel_sessions
import org.vetta.android.resources.notify_failed
import org.vetta.android.resources.notify_finished
import org.vetta.android.resources.notify_link_text
import org.vetta.android.resources.notify_link_title
import org.vetta.android.resources.notify_needs_you
import org.vetta.android.resources.notify_reply
import org.vetta.android.resources.notify_reply_failed
import org.vetta.android.resources.notify_reply_hint
import org.vetta.android.resources.work_untitled
import org.vetta.android.shared.R

/**
 * Tells the user about sessions while the app is out of sight: a session that starts
 * waiting on them, and one whose turn finishes or fails. Tapping one opens its chat.
 * Nothing is posted while the app is on screen, where the list already shows it, except
 * what arrived in the moments before it left.
 */
object SessionNotifier {
    /** The intent extra naming the session a notification opens. */
    const val EXTRA_SESSION_ID = "org.vetta.android.extra.SESSION_ID"

    private const val CHANNEL_SESSIONS = "sessions"
    private const val CHANNEL_LINK = "link"
    const val LINK_NOTIFICATION_ID = 1

    /** The key a typed reply arrives under. */
    const val KEY_REPLY = "org.vetta.android.reply"
    private const val TYPED = QuickReply.MAX_CHOICES

    fun watch(context: Context, container: AppContainer, scope: CoroutineScope) {
        // News that came while the app still counted as on screen, in case it was already leaving.
        val held = mutableListOf<HeldAlert>()
        suspend fun announce(alert: SessionAlert) {
            val question = (alert as? SessionAlert.NeedsYou)?.let { container.mirror.state.value.transcript(it.sessionId).pendingQuestion }
            post(context, alert, question)
        }
        scope.launch {
            var last = container.mirror.state.value.sessions
            container.mirror.state.map { it.sessions }.distinctUntilChanged().collect { sessions ->
                val alerts = SessionAlerts.between(last, sessions)
                last = sessions
                if (container.visible.value) {
                    held += alerts.map { HeldAlert(it, nowEpochMs()) }
                } else {
                    alerts.forEach { announce(it) }
                }
            }
        }
        scope.launch {
            container.visible.drop(1).collect { shown ->
                if (!shown) {
                    SessionAlerts.dueOnLeaving(held.toList(), container.mirror.state.value.sessions, nowEpochMs()).forEach { announce(it) }
                }
                held.clear()
            }
        }
    }

    private suspend fun post(context: Context, alert: SessionAlert, question: RemoteQuestionRequest?) {
        if (!allowed(context)) return
        ensureChannels(context)
        val text =
            getString(
                when (alert) {
                    is SessionAlert.NeedsYou -> Res.string.notify_needs_you
                    is SessionAlert.Finished -> Res.string.notify_finished
                    is SessionAlert.Failed -> Res.string.notify_failed
                },
            )
        val prompt = question?.let(QuickReply::prompt)
        val builder =
            NotificationCompat.Builder(context, CHANNEL_SESSIONS)
                .setSmallIcon(R.drawable.ic_stat_vetta)
                .setContentTitle(alert.title.ifEmpty { getString(Res.string.work_untitled) })
                .setContentText(prompt ?: text)
                .setAutoCancel(true)
                .setCategory(if (alert is SessionAlert.NeedsYou) NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_STATUS)
                .setPriority(if (alert is SessionAlert.NeedsYou) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
                .setContentIntent(openSession(context, alert.sessionId))
        if (prompt != null) builder.setStyle(NotificationCompat.BigTextStyle().bigText(prompt))
        if (question != null && QuickReply.canReply(question)) {
            // Buttons for the options that fit, then a typed reply, answered without opening the app.
            QuickReply.choices(question).forEachIndexed { index, label ->
                builder.addAction(0, label, reply(context, alert.sessionId, question.requestId, index, label))
            }
            if (QuickReply.choices(question).size < QuickReply.MAX_CHOICES) {
                val input = RemoteInput.Builder(KEY_REPLY).setLabel(getString(Res.string.notify_reply_hint)).build()
                builder.addAction(
                    NotificationCompat.Action.Builder(0, getString(Res.string.notify_reply), reply(context, alert.sessionId, question.requestId, TYPED, null))
                        .addRemoteInput(input)
                        .setAllowGeneratedReplies(false)
                        .build(),
                )
            }
        }
        // One notification per session: a newer state replaces the older one.
        runCatching { NotificationManagerCompat.from(context).notify(alert.sessionId.hashCode(), builder.build()) }
            .onFailure { PlatformRemoteLogger.warn("session notification failed", mapOf("error" to (it.message ?: it::class.simpleName))) }
    }

    /** After an answer from the notification: gone when it arrived, a way back into the app when not. */
    suspend fun replied(context: Context, sessionId: String, title: String, delivered: Boolean) {
        val manager = NotificationManagerCompat.from(context)
        if (delivered) {
            manager.cancel(sessionId.hashCode())
            return
        }
        if (!allowed(context)) return
        ensureChannels(context)
        val notification =
            NotificationCompat.Builder(context, CHANNEL_SESSIONS)
                .setSmallIcon(R.drawable.ic_stat_vetta)
                .setContentTitle(title.ifEmpty { getString(Res.string.work_untitled) })
                .setContentText(getString(Res.string.notify_reply_failed))
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(openSession(context, sessionId))
                .build()
        runCatching { manager.notify(sessionId.hashCode(), notification) }
    }

    private fun reply(context: Context, sessionId: String, requestId: String, slot: Int, answer: String?): PendingIntent {
        val intent =
            Intent(context, QuestionReplyReceiver::class.java)
                .putExtra(EXTRA_SESSION_ID, sessionId)
                .putExtra(QuestionReplyReceiver.EXTRA_REQUEST_ID, requestId)
                .apply { if (answer != null) putExtra(QuestionReplyReceiver.EXTRA_ANSWER, answer) }
        // A typed reply needs a mutable intent for the system to add the text to.
        val mutability = if (answer == null) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(context, 31 * sessionId.hashCode() + slot, intent, PendingIntent.FLAG_UPDATE_CURRENT or mutability)
    }

    /** The ongoing notice while the link is kept up in the background. */
    suspend fun linkNotification(context: Context, desktopName: String): Notification {
        ensureChannels(context)
        return NotificationCompat.Builder(context, CHANNEL_LINK)
            .setSmallIcon(R.drawable.ic_stat_vetta)
            .setContentTitle(getString(Res.string.notify_link_title, desktopName))
            .setContentText(getString(Res.string.notify_link_text))
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(openSession(context, null))
            .build()
    }

    /**
     * The ongoing notice before its localized text is loaded: the app's name only. Its
     * channel is made here too, under the app's name until [linkNotification] names it.
     */
    fun plainLinkNotification(context: Context): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(NotificationManager::class.java)
            if (manager != null && manager.getNotificationChannel(CHANNEL_LINK) == null) {
                val label = context.applicationInfo.loadLabel(context.packageManager)
                manager.createNotificationChannel(NotificationChannel(CHANNEL_LINK, label, NotificationManager.IMPORTANCE_MIN).apply { setShowBadge(false) })
            }
        }
        return NotificationCompat.Builder(context, CHANNEL_LINK)
            .setSmallIcon(R.drawable.ic_stat_vetta)
            .setContentTitle(context.applicationInfo.loadLabel(context.packageManager))
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(openSession(context, null))
            .build()
    }

    fun allowed(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun openSession(context: Context, sessionId: String?): PendingIntent {
        val intent =
            (context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent())
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .apply { if (sessionId != null) putExtra(EXTRA_SESSION_ID, sessionId) }
        return PendingIntent.getActivity(
            context,
            sessionId?.hashCode() ?: 0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private suspend fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_SESSIONS, getString(Res.string.notify_channel_sessions), NotificationManager.IMPORTANCE_HIGH),
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_LINK, getString(Res.string.notify_channel_link), NotificationManager.IMPORTANCE_MIN).apply { setShowBadge(false) },
        )
    }
}
