package org.vetta.android.domain.remote

data class RemoteDesktopTarget(
    val url: String,
    val sessionId: String,
)

fun remoteDesktopViewerTarget(controlUrl: String): RemoteDesktopTarget? {
    val match = Regex("^(wss?://[^#]+/v1/relay/([A-Za-z0-9_-]{24,128})/mobile)(#.+)?$").matchEntire(controlUrl)
        ?: return null
    val pairingId = match.groupValues[2]
    val secret = match.groupValues[3]
    val base = match.groupValues[1].substringBefore("/v1/relay/")
    return RemoteDesktopTarget("$base/v1/desktop/$pairingId/viewer$secret", pairingId)
}
