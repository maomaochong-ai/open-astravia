package org.vetta.android.domain.work

import kotlinx.serialization.Serializable

/** A span of the day, in minutes after midnight, that may run past midnight (22:00–08:00). */
@Serializable
data class QuietHours(
    val startMinute: Int = 22 * 60,
    val endMinute: Int = 8 * 60,
) {
    operator fun contains(minuteOfDay: Int): Boolean =
        when {
            startMinute == endMinute -> false
            startMinute < endMinute -> minuteOfDay in startMinute until endMinute
            else -> minuteOfDay >= startMinute || minuteOfDay < endMinute
        }
}

/** Which session news reaches the phone as a notification, and how. */
@Serializable
data class NotificationPrefs(
    val needsYou: Boolean = true,
    val finished: Boolean = true,
    val failed: Boolean = true,
    /** Projects (by working directory) whose sessions stay quiet. */
    val mutedProjects: Set<String> = emptySet(),
    /** When set, notifications during these hours arrive without sound or vibration. */
    val quietHours: QuietHours? = null,
)

enum class Delivery {
    /** Not posted. */
    Skip,

    /** Posted without sound or vibration. */
    Silent,
    Alert,
}

object NotificationRules {
    /**
     * How an alert about a session in `projectCwd` is delivered at `minuteOfDay`: dropped
     * for a kind or a project turned off, quiet during quiet hours (it is still there to
     * read in the morning), otherwise with sound.
     */
    fun delivery(alert: SessionAlert, projectCwd: String?, prefs: NotificationPrefs, minuteOfDay: Int): Delivery {
        val wanted =
            when (alert) {
                is SessionAlert.NeedsYou -> prefs.needsYou
                is SessionAlert.Finished -> prefs.finished
                is SessionAlert.Failed -> prefs.failed
            }
        if (!wanted || (projectCwd != null && projectCwd in prefs.mutedProjects)) return Delivery.Skip
        return if (prefs.quietHours?.contains(minuteOfDay) == true) Delivery.Silent else Delivery.Alert
    }
}
