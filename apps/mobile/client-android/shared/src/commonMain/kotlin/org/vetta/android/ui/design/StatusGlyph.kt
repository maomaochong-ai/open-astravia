package org.vetta.android.ui.design

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PriorityHigh
import androidx.compose.material.icons.filled.QuestionMark
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.resources.Res
import org.vetta.android.resources.work_status_error
import org.vetta.android.resources.work_status_running
import org.vetta.android.resources.work_status_thinking
import org.vetta.android.resources.work_status_waiting
import org.vetta.android.ui.work.workColors

/** Whether a session's state gets a glyph: only while it needs a look. */
fun RemoteSessionStatus.hasGlyph(): Boolean =
    this == RemoteSessionStatus.WaitingInput || this == RemoteSessionStatus.Running ||
        this == RemoteSessionStatus.Thinking || this == RemoteSessionStatus.Error

/** The glyph's words, for screen readers; null where there is no glyph. */
@Composable
fun statusLabel(status: RemoteSessionStatus): String? =
    when (status) {
        RemoteSessionStatus.WaitingInput -> stringResource(Res.string.work_status_waiting)
        RemoteSessionStatus.Running -> stringResource(Res.string.work_status_running)
        RemoteSessionStatus.Thinking -> stringResource(Res.string.work_status_thinking)
        RemoteSessionStatus.Error -> stringResource(Res.string.work_status_error)
        else -> null
    }

/**
 * A session's state as a coloured symbol, only while it needs a look (the iPhone's
 * `StatusGlyph`); it moves while the state is live: working turns, waiting breathes.
 * Draws nothing for a finished or idle session.
 */
@Composable
fun StatusGlyph(status: RemoteSessionStatus, modifier: Modifier = Modifier, size: Dp = 16.dp) {
    if (!status.hasGlyph()) return
    val colors = MaterialTheme.workColors
    val motion = rememberInfiniteTransition(label = "status glyph")
    when (status) {
        RemoteSessionStatus.Running, RemoteSessionStatus.Thinking -> {
            val turn by motion.animateFloat(0f, 360f, infiniteRepeatable(tween(1_400, easing = LinearEasing)), label = "turn")
            Icon(Icons.Filled.Sync, contentDescription = null, tint = colors.blue, modifier = modifier.graphicsLayer { rotationZ = -turn }.size(size))
        }
        RemoteSessionStatus.WaitingInput -> {
            val breath by motion.animateFloat(0.55f, 1f, infiniteRepeatable(tween(1_100), RepeatMode.Reverse), label = "breathe")
            Icon(
                Icons.Filled.QuestionMark,
                contentDescription = null,
                tint = colors.yellow,
                modifier =
                    modifier.graphicsLayer {
                        alpha = breath
                        scaleX = 0.9f + 0.1f * breath
                        scaleY = 0.9f + 0.1f * breath
                    }.size(size),
            )
        }
        else -> Icon(Icons.Filled.PriorityHigh, contentDescription = null, tint = colors.red, modifier = modifier.size(size))
    }
}
