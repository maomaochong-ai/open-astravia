package org.vetta.android.ui.work

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Laptop
import androidx.compose.material.icons.filled.PriorityHigh
import androidx.compose.material.icons.filled.QuestionMark
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.outlined.LaptopChromebook
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.pluralStringResource
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.link.DesktopLink
import org.vetta.android.domain.remote.link.LinkChannel
import org.vetta.android.domain.remote.link.LinkIndicator
import org.vetta.android.domain.remote.link.LinkSnapshot
import org.vetta.android.resources.Res
import org.vetta.android.resources.close
import org.vetta.android.resources.link_connected
import org.vetta.android.resources.link_connecting
import org.vetta.android.resources.link_latency
import org.vetta.android.resources.link_offline
import org.vetta.android.resources.link_reconnect
import org.vetta.android.resources.link_reconnecting
import org.vetta.android.resources.link_status
import org.vetta.android.resources.link_unauthorized
import org.vetta.android.resources.link_via_lan
import org.vetta.android.resources.link_via_p2p
import org.vetta.android.resources.link_via_relay
import org.vetta.android.resources.work_status_aborted
import org.vetta.android.resources.work_status_done
import org.vetta.android.resources.work_status_error
import org.vetta.android.resources.work_status_running
import org.vetta.android.resources.work_status_thinking
import org.vetta.android.resources.work_status_waiting
import org.vetta.android.ui.theme.vettaExtra

/**
 * A session's state in a list row's avatar slot, the way Mail shows the sender:
 * a coloured disc with one glyph. Only the states that want a look move.
 */
@Composable
fun StatusAvatar(status: RemoteSessionStatus, size: Dp = 40.dp) {
    val colors = MaterialTheme.workColors
    val (icon, fill, label) =
        when (status) {
            RemoteSessionStatus.Running -> Triple(Icons.Filled.Sync, colors.blue, stringResource(Res.string.work_status_running))
            RemoteSessionStatus.Thinking -> Triple(Icons.Filled.Sync, colors.blue, stringResource(Res.string.work_status_thinking))
            RemoteSessionStatus.WaitingInput -> Triple(Icons.Filled.QuestionMark, colors.yellow, stringResource(Res.string.work_status_waiting))
            RemoteSessionStatus.Error -> Triple(Icons.Filled.PriorityHigh, colors.red, stringResource(Res.string.work_status_error))
            RemoteSessionStatus.Aborted -> Triple(Icons.Filled.Stop, colors.faint, stringResource(Res.string.work_status_aborted))
            RemoteSessionStatus.Idle, RemoteSessionStatus.Completed -> Triple(Icons.Filled.Check, colors.green, stringResource(Res.string.work_status_done))
        }
    // Dark ink: white would wash out on yellow.
    val ink = if (status == RemoteSessionStatus.WaitingInput) Color.Black else Color.White
    val motion = rememberInfiniteTransition(label = "status avatar")
    val turn by motion.animateFloat(0f, 360f, infiniteRepeatable(tween(1_600, easing = LinearEasing)), label = "spin")
    val hop by motion.animateFloat(
        0f,
        0f,
        infiniteRepeatable(
            keyframes {
                durationMillis = 2_000
                0f at 0
                -4f at 150
                0f at 300
                0f at 2_000
            },
            RepeatMode.Restart,
        ),
        label = "hop",
    )
    Box(
        Modifier
            .size(size)
            .clip(CircleShape)
            .background(fill)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = ink,
            modifier =
                Modifier
                    .size(size * 0.5f)
                    .then(
                        when (status) {
                            RemoteSessionStatus.Running, RemoteSessionStatus.Thinking -> Modifier.rotate(turn)
                            RemoteSessionStatus.WaitingInput -> Modifier.graphicsLayer { translationY = hop * density }
                            else -> Modifier
                        },
                    ),
        )
    }
}

/** The link in words, as the status button and its dialog show it. */
@Composable
fun describe(indicator: LinkIndicator): String =
    when (indicator) {
        LinkIndicator.Online -> stringResource(Res.string.link_connected)
        LinkIndicator.Connecting -> stringResource(Res.string.link_connecting)
        is LinkIndicator.Reconnecting -> pluralStringResource(Res.plurals.link_reconnecting, indicator.attempt, indicator.attempt)
        LinkIndicator.Offline -> stringResource(Res.string.link_offline)
    }

/** How the phone reaches the desktop, with the latency when it is known. */
@Composable
fun linkDetail(link: LinkSnapshot): String? {
    val channel = link.channel ?: return null
    val via =
        stringResource(
            when (channel) {
                LinkChannel.P2p -> Res.string.link_via_p2p
                LinkChannel.Lan -> Res.string.link_via_lan
                LinkChannel.Relay -> Res.string.link_via_relay
            },
        )
    val rtt = link.rttMs?.takeIf { it > 0 } ?: return via
    return "$via · ${stringResource(Res.string.link_latency, rtt.toInt())}"
}

/** The computer icon next to the Work title; tapping it explains the link and offers a reconnect. */
@Composable
fun LinkStatusButton(link: LinkSnapshot, onReconnect: () -> Unit) {
    val indicator = LinkIndicator.of(link)
    val colors = MaterialTheme.workColors
    var open by remember { mutableStateOf(false) }
    val tint =
        when (indicator) {
            LinkIndicator.Online -> colors.green
            LinkIndicator.Offline -> colors.red
            else -> MaterialTheme.vettaExtra.secondaryText
        }
    val description = describe(indicator)
    IconButton(
        onClick = { open = true },
        modifier =
            Modifier
                .testTag("link.status")
                .semantics { stateDescription = description },
    ) {
        Icon(
            if (indicator == LinkIndicator.Offline) Icons.Outlined.LaptopChromebook else Icons.Filled.Laptop,
            contentDescription = stringResource(Res.string.link_status),
            tint = tint,
        )
    }
    if (open) {
        val detail = if (indicator == LinkIndicator.Online) linkDetail(link) else null
        val unauthorized = link.lastError == DesktopLink.UNAUTHORIZED
        AlertDialog(
            onDismissRequest = { open = false },
            title = { Text(description) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    detail?.let { Text(it, color = MaterialTheme.vettaExtra.secondaryText) }
                    if (unauthorized) Text(stringResource(Res.string.link_unauthorized), color = MaterialTheme.vettaExtra.secondaryText)
                }
            },
            confirmButton = {
                if (indicator == LinkIndicator.Offline) {
                    TextButton(
                        onClick = {
                            onReconnect()
                            open = false
                        },
                        modifier = Modifier.testTag("link.reconnect"),
                    ) { Text(stringResource(Res.string.link_reconnect)) }
                } else {
                    TextButton(onClick = { open = false }) { Text(stringResource(Res.string.close)) }
                }
            },
            dismissButton =
                if (indicator == LinkIndicator.Offline) {
                    { TextButton(onClick = { open = false }) { Text(stringResource(Res.string.close)) } }
                } else {
                    null
                },
        )
    }
}

/** A centred message for an empty list, with its one action. */
@Composable
fun WorkEmptyState(icon: ImageVector, title: String, description: String, action: (@Composable () -> Unit)? = null) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(44.dp), tint = MaterialTheme.vettaExtra.secondaryText)
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Text(description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.vettaExtra.secondaryText, textAlign = TextAlign.Center)
        if (action != null) Box(Modifier.padding(top = 8.dp)) { action() }
    }
}
