package org.astravia.android.ui.work

import androidx.compose.runtime.Composable
import org.jetbrains.compose.resources.stringResource
import org.astravia.android.domain.work.MirrorError
import org.astravia.android.resources.Res
import org.astravia.android.resources.chat_compacting
import org.astravia.android.resources.chat_level_high
import org.astravia.android.resources.chat_level_low
import org.astravia.android.resources.chat_level_max
import org.astravia.android.resources.chat_level_medium
import org.astravia.android.resources.chat_level_minimal
import org.astravia.android.resources.chat_level_none
import org.astravia.android.resources.chat_level_off
import org.astravia.android.resources.chat_level_xhigh
import org.astravia.android.resources.chat_retrying
import org.astravia.android.resources.chat_today_at
import org.astravia.android.resources.work_error_not_connected
import org.astravia.android.resources.work_error_unknown
import org.astravia.android.resources.work_untitled
import java.util.Calendar

/** A thinking level in the phone's language; unknown levels show as the desktop names them. */
@Composable
fun levelLabel(level: String): String =
    when (level) {
        "off" -> stringResource(Res.string.chat_level_off)
        "none" -> stringResource(Res.string.chat_level_none)
        "minimal" -> stringResource(Res.string.chat_level_minimal)
        "low" -> stringResource(Res.string.chat_level_low)
        "medium" -> stringResource(Res.string.chat_level_medium)
        "high" -> stringResource(Res.string.chat_level_high)
        "xhigh" -> stringResource(Res.string.chat_level_xhigh)
        "max" -> stringResource(Res.string.chat_level_max)
        else -> level
    }

/** The desktop's `session.state.detail` ("retry 1/3", "compacting") in the phone's language. */
@Composable
fun activityLabel(detail: String?): String? {
    if (detail == "compacting") return stringResource(Res.string.chat_compacting)
    val retry = detail?.let(RETRY::matchEntire) ?: return null
    return stringResource(Res.string.chat_retrying, retry.groupValues[1].toInt(), retry.groupValues[2].toInt())
}

/** "Today 14:05": the time the conversation above started. */
@Composable
fun clockLabel(epochMs: Long): String {
    val calendar = Calendar.getInstance().apply { timeInMillis = epochMs }
    val time = "%02d:%02d".format(calendar.get(Calendar.HOUR_OF_DAY), calendar.get(Calendar.MINUTE))
    return stringResource(Res.string.chat_today_at, time)
}

/** A desktop session's title, or the placeholder the desktop sidebar shows for an untitled one. */
@Composable
fun workSessionTitle(title: String?): String =
    title?.trim()?.takeIf(String::isNotEmpty) ?: stringResource(Res.string.work_untitled)

@Composable
fun MirrorError.message(): String =
    when (this) {
        MirrorError.NotConnected -> stringResource(Res.string.work_error_not_connected)
        MirrorError.Unknown -> stringResource(Res.string.work_error_unknown)
    }

private val RETRY = Regex("retry (\\d+)/(\\d+)")
