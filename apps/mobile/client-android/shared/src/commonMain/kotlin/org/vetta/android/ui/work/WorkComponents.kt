package org.vetta.android.ui.work

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import org.jetbrains.compose.resources.pluralStringResource
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.link.LinkChannel
import org.vetta.android.domain.remote.link.LinkIndicator
import org.vetta.android.domain.remote.link.LinkSnapshot
import org.vetta.android.resources.Res
import org.vetta.android.resources.link_connected
import org.vetta.android.resources.link_connecting
import org.vetta.android.resources.link_latency
import org.vetta.android.resources.link_offline
import org.vetta.android.resources.link_reconnecting
import org.vetta.android.resources.link_via_lan
import org.vetta.android.resources.link_via_p2p
import org.vetta.android.resources.link_via_relay

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
