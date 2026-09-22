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
    val connectedDuration: String? = null,
    val cpu: String? = null,
    val ram: String? = null,
)

data class SessionListItem(
    val id: String,
    val title: String,
    val subtitle: String,
    val sourceLabel: String,
    val timeLabel: String,
    val isCloud: Boolean,
    val favorite: Boolean = false,
)
