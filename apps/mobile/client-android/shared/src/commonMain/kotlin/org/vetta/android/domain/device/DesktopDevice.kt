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
    val connectedDurationMs: Long? = null,
    val cpu: String? = null,
    val ram: String? = null,
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
