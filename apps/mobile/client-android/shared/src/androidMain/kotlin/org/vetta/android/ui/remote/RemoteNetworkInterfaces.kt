package org.vetta.android.ui.remote

import java.net.NetworkInterface
import java.net.SocketException
import org.vetta.android.domain.remote.RemoteNetworkInterface

/** Read actual interface prefixes without relying on the default internet network. */
internal fun remoteNetworkInterfaces(): List<RemoteNetworkInterface> = try {
    NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
        .filter { it.isUp && !it.isLoopback }
        .flatMap { network ->
            network.interfaceAddresses.mapNotNull { address ->
                val host = address.address?.hostAddress ?: return@mapNotNull null
                RemoteNetworkInterface(host, address.networkPrefixLength.toInt(), network.name.startsWith("tun") || network.name.startsWith("tap"))
            }
        }
} catch (_: SocketException) {
    emptyList()
} catch (_: SecurityException) {
    emptyList()
}
