package org.vetta.android.domain.device

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import org.vetta.android.domain.remote.link.LinkChannel
import org.vetta.android.domain.remote.link.LinkIndicator
import org.vetta.android.domain.work.DesktopMirror
import org.vetta.android.domain.work.MirrorState

/** The paired desktop as a device for the Home, Discover and device screens, and pairing it. */
interface DesktopGateway {
    val devices: StateFlow<List<DesktopDevice>>

    /** Pairs with the desktop in a scanned code; false when that did not work. */
    suspend fun connect(target: String): Boolean

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

    override suspend fun connect(target: String): Boolean = mirror.pairWithCode(target)

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
