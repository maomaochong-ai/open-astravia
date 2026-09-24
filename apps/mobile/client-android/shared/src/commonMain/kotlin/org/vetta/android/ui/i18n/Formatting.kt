package org.vetta.android.ui.i18n

import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.produceState
import kotlinx.coroutines.delay
import org.jetbrains.compose.resources.pluralStringResource
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.device.SessionListItem
import org.vetta.android.domain.session.nowEpochMs
import org.vetta.android.resources.Res
import org.vetta.android.resources.days_ago
import org.vetta.android.resources.desktop_device
import org.vetta.android.resources.duration_hours_minutes
import org.vetta.android.resources.duration_minutes_seconds
import org.vetta.android.resources.duration_seconds
import org.vetta.android.resources.filter_cloud
import org.vetta.android.resources.half_hour_ago
import org.vetta.android.resources.hours_ago
import org.vetta.android.resources.just_now
import org.vetta.android.resources.minutes_ago
import org.vetta.android.resources.untitled_chat

/** How long ago `epochMs` was, in the coarsest unit that fits (the iPhone app's rules). */
@Composable
fun relativeTimeLabel(epochMs: Long, now: Long = nowEpochMs()): String {
    val minutes = ((now - epochMs).coerceAtLeast(0) / 60_000).toInt()
    val hours = minutes / 60
    return when {
        minutes < 1 -> stringResource(Res.string.just_now)
        minutes < 25 -> pluralStringResource(Res.plurals.minutes_ago, minutes, minutes)
        minutes < 45 -> stringResource(Res.string.half_hour_ago)
        hours < 1 -> pluralStringResource(Res.plurals.minutes_ago, minutes, minutes)
        hours < 24 -> pluralStringResource(Res.plurals.hours_ago, hours, hours)
        else -> pluralStringResource(Res.plurals.days_ago, hours / 24, hours / 24)
    }
}

/** A connection's age; always at least one second so a fresh link never reads as zero. */
@Composable
fun durationLabel(elapsedMs: Long): String {
    val totalSeconds = (elapsedMs.coerceAtLeast(0) / 1_000).coerceAtLeast(1).toInt()
    val hours = totalSeconds / 3_600
    val minutes = (totalSeconds % 3_600) / 60
    val seconds = totalSeconds % 60
    return when {
        hours > 0 -> stringResource(Res.string.duration_hours_minutes, hours, minutes)
        minutes > 0 -> stringResource(Res.string.duration_minutes_seconds, minutes, seconds)
        else -> stringResource(Res.string.duration_seconds, seconds)
    }
}

/** A session's title, or the localized placeholder while it has none. */
@Composable
fun sessionTitle(title: String?): String =
    title?.trim()?.takeIf { it.isNotEmpty() } ?: stringResource(Res.string.untitled_chat)

/** Where a listed session runs: its device or model, else the kind's generic name. */
@Composable
fun SessionListItem.sourceText(): String =
    sourceLabel ?: stringResource(if (isCloud) Res.string.filter_cloud else Res.string.desktop_device)

/** The wall clock, ticking every `intervalMs` while shown, for labels that age. */
@Composable
fun rememberClock(intervalMs: Long = 1_000): State<Long> =
    produceState(nowEpochMs(), intervalMs) {
        while (true) {
            delay(intervalMs)
            value = nowEpochMs()
        }
    }
