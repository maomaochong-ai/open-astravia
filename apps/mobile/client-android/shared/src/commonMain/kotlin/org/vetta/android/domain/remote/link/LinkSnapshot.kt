package org.vetta.android.domain.remote.link

import org.vetta.android.domain.remote.RemoteDeviceStatus

enum class LinkStatus {
    Offline,
    Connecting,
    Online,
}

enum class LinkChannel {
    P2p,
    Lan,
    Relay,
}

/** Desktop facts from `diagnostics.snapshot`, refreshed with each latency sample. */
data class DesktopDiagnostics(val osLabel: String?, val cpu: String?, val ram: String?)

data class LinkSnapshot(
    val status: LinkStatus,
    val channel: LinkChannel? = null,
    val rttMs: Long? = null,
    /** False when the transport is up but the relay reports the desktop absent. */
    val peerOnline: Boolean = false,
    val desktop: RemoteDeviceStatus? = null,
    val diagnostics: DesktopDiagnostics? = null,
    val lastError: String? = null,
    val reconnectAttempt: Int = 0,
    /** When the current channel came up, for "connected for". */
    val onlineSince: Long? = null,
) {
    val isUsable: Boolean
        get() = status == LinkStatus.Online && peerOnline

    companion object {
        val Offline = LinkSnapshot(LinkStatus.Offline)
    }
}

/** The link state as the work page shows it next to its title. */
sealed interface LinkIndicator {
    data object Online : LinkIndicator

    data object Connecting : LinkIndicator

    data class Reconnecting(val attempt: Int) : LinkIndicator

    /** Also covers a relay that is up while the desktop itself is away. */
    data object Offline : LinkIndicator

    companion object {
        fun of(link: LinkSnapshot): LinkIndicator =
            when (link.status) {
                LinkStatus.Online -> if (link.peerOnline) Online else Offline
                LinkStatus.Connecting -> if (link.reconnectAttempt > 0) Reconnecting(link.reconnectAttempt) else Connecting
                // Nothing has failed yet: the first attempt is about to start
                // (launch, or back from the background).
                LinkStatus.Offline -> if (link.lastError == null && link.reconnectAttempt == 0) Connecting else Offline
            }
    }
}

/** A request was made while no usable channel to the desktop exists. */
class LinkOfflineException : IllegalStateException("desktop is offline")
