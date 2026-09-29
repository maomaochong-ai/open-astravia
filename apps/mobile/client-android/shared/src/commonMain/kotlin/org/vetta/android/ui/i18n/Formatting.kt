package org.vetta.android.ui.i18n

import androidx.compose.runtime.Composable
import org.jetbrains.compose.resources.pluralStringResource
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.core.nowEpochMs
import org.vetta.android.resources.Res
import org.vetta.android.resources.days_ago
import org.vetta.android.resources.half_hour_ago
import org.vetta.android.resources.hours_ago
import org.vetta.android.resources.just_now
import org.vetta.android.resources.minutes_ago

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
