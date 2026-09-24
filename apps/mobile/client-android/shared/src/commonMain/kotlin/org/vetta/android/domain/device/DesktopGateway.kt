package org.vetta.android.domain.device

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import org.vetta.android.domain.remote.link.LinkChannel
import org.vetta.android.domain.remote.link.LinkIndicator
import org.vetta.android.domain.remote.pairing.PairingFailure
import org.vetta.android.domain.remote.pairing.PairingPhase
import org.vetta.android.domain.work.DesktopMirror
import org.vetta.android.domain.work.MirrorState

/** How a pairing ended. */
sealed interface PairingResult {
    data object Paired : PairingResult

    /** The person stopped it; nothing to report. */
    data object Cancelled : PairingResult

    data class Failed(val reason: PairingFailure) : PairingResult
}

/** The paired desktop as a device for the Home, Discover and device screens, and pairing it. */
interface DesktopGateway {
    val devices: StateFlow<List<DesktopDevice>>

    /** Pairs with the desktop in a scanned code. */
    suspend fun connect(target: String): PairingResult

    /** Pairs with the desktop at a typed `host:port` on the local network. */
    suspend fun connectManually(endpoint: String): PairingResult

    suspend fun disconnect(deviceId: String)
}

/** [DesktopGateway] over the mirror's pairing and its one link. */
class MirrorDesktopGateway(
    private val mirror: DesktopMirror,
    scope: CoroutineScope,
) : DesktopGateway {
    override val devices: StateFlow<List<DesktopDevice>> =
        mirror.state
            .map(::devicesOf)
            .stateIn(scope, SharingStarted.Eagerly, devicesOf(mirror.state.value))

    override suspend fun connect(target: String): PairingResult = result(mirror.pairWithCode(target))

    override suspend fun connectManually(endpoint: String): PairingResult = result(mirror.pairManually(endpoint))

    private fun result(paired: Boolean): PairingResult =
        when {
            paired -> PairingResult.Paired
            else -> (mirror.state.value.pairing as? PairingPhase.Failed)?.let { PairingResult.Failed(it.reason) } ?: PairingResult.Cancelled
        }

    override suspend fun disconnect(deviceId: String) {
        mirror.unpair()
    }

    private fun devicesOf(state: MirrorState): List<DesktopDevice> {
        val desktop = state.desktop ?: return emptyList()
        val link = state.link
        return listOf(
            DesktopDevice(
                id = desktop.desktopIdentityKey,
                name = desktop.desktopName,
                osLabel = link.diagnostics?.osLabel ?: link.desktop?.osLabel ?: "Desktop",
                host = desktop.relayBaseUrl?.substringAfter("://")?.substringBefore('/').orEmpty(),
                status =
                    when (LinkIndicator.of(link)) {
                        LinkIndicator.Online -> DeviceStatus.Online
                        LinkIndicator.Connecting, is LinkIndicator.Reconnecting -> DeviceStatus.Connecting
                        LinkIndicator.Offline -> DeviceStatus.Offline
                    },
                channel = if (link.channel == LinkChannel.Lan) ConnectChannel.Lan else ConnectChannel.Remote,
                latencyMs = link.rttMs?.toIntOrNull(),
                onlineSinceEpochMs = link.onlineSince,
                cpu = link.diagnostics?.cpu,
                ram = link.diagnostics?.ram,
                viewerUrl = mirror.viewerUrl(),
            ),
        )
    }
}

private fun Long.toIntOrNull(): Int? = takeIf { it in 0..Int.MAX_VALUE.toLong() }?.toInt()
