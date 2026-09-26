package org.vetta.android.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.text.format.DateFormat
import android.widget.RemoteViews
import org.vetta.android.domain.work.LaunchTarget
import org.vetta.android.domain.work.WidgetSummary
import org.vetta.android.shared.R
import java.util.Date

/**
 * The home screen widget: how many sessions wait on the user and how many are at work;
 * while the computer is offline, since when. Tapping it opens the task board. The app
 * pushes each change, and the system asks every half hour so a widget left from a closed
 * app catches up.
 */
class SessionsWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val summary = WidgetSummary.of(AndroidAppContainer.get(context).mirror.state.value)
        manager.updateAppWidget(ids, views(context, summary))
    }

    companion object {
        fun update(context: Context, summary: WidgetSummary) {
            val manager = AppWidgetManager.getInstance(context) ?: return
            val ids = manager.getAppWidgetIds(ComponentName(context, SessionsWidget::class.java))
            if (ids.isEmpty()) return
            runCatching { manager.updateAppWidget(ids, views(context, summary)) }
        }

        private fun views(context: Context, summary: WidgetSummary): RemoteViews {
            val res = context.resources
            val headline =
                when {
                    summary.state == WidgetSummary.State.Unpaired -> res.getString(R.string.widget_unpaired)
                    summary.waiting > 0 -> res.getQuantityString(R.plurals.widget_waiting, summary.waiting, summary.waiting)
                    summary.working > 0 -> res.getQuantityString(R.plurals.widget_working, summary.working, summary.working)
                    else -> res.getString(R.string.widget_all_clear)
                }
            val status =
                buildList {
                    if (summary.state == WidgetSummary.State.Unpaired) {
                        add(res.getString(R.string.widget_unpaired_hint))
                        return@buildList
                    }
                    // What is running, when the headline was about what waits.
                    if (summary.waiting > 0 && summary.working > 0) add(res.getQuantityString(R.plurals.widget_working, summary.working, summary.working))
                    // Offline, the numbers are the last ones seen: say when that was.
                    if (summary.state == WidgetSummary.State.Offline) {
                        add(res.getString(R.string.widget_offline))
                        summary.lastSeenAt?.let { add(res.getString(R.string.widget_updated, DateFormat.getTimeFormat(context).format(Date(it)))) }
                    }
                }
            return RemoteViews(context.packageName, R.layout.widget_sessions).apply {
                setTextViewText(R.id.widget_headline, headline)
                setTextViewText(R.id.widget_detail, status.joinToString(" · "))
                setOnClickPendingIntent(R.id.widget_root, open(context))
            }
        }

        private fun open(context: Context): PendingIntent {
            val intent =
                (context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent())
                    .setAction(LaunchTarget.TaskBoard.action)
                    .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
    }
}
