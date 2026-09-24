package org.vetta.android.domain.remote

data class RemoteDesktopTarget(
    val url: String,
    val sessionId: String,
)

fun remoteDesktopViewerTarget(controlUrl: String): RemoteDesktopTarget? {
    val target = parseMobileConnectionTarget(controlUrl) ?: return null
    val match = Regex("^(wss?://.+)/v2/relay/([A-Za-z0-9_-]{16,128})/mobile$").matchEntire(target.url) ?: return null
    val pairingId = match.groupValues[2]
    return RemoteDesktopTarget(
        "${match.groupValues[1]}/v2/desktop/$pairingId/viewer#pairing=${target.pairingSecret}",
        pairingId,
    )
}
