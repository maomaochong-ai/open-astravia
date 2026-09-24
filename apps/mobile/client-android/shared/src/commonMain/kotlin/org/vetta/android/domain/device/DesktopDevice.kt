package org.vetta.android.domain.device

enum class DeviceStatus {
    Online,
    Offline,
    Connecting,
}

enum class ConnectChannel {
    Lan,
    Remote,
    Cloud,
}

data class DesktopDevice(
    val id: String,
    val name: String,
    val osLabel: String,
    val host: String,
    val status: DeviceStatus,
    val channel: ConnectChannel = ConnectChannel.Lan,
    val latencyMs: Int? = null,
    /** When the current connection came up, for "connected for". */
    val onlineSinceEpochMs: Long? = null,
    val cpu: String? = null,
    val ram: String? = null,
    /** The relay's screen-sharing viewer for this desktop, when it is reachable that way. */
    val viewerUrl: String? = null,
)

data class SessionListItem(
    val id: String,
    val title: String,
    val subtitle: String,
    /** Device or model name; null falls back to the kind's generic label. */
    val sourceLabel: String?,
    val updatedAtEpochMs: Long,
    val isCloud: Boolean,
    val favorite: Boolean = false,
)
