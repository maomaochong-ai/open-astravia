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

/** UI 演示用设备清单；后续替换为真实 Desktop 发现/连接协议。 */
object DemoDevices {
    val all: List<DesktopDevice> =
        listOf(
            DesktopDevice(
                id = "desk-01",
                name = "DESKTOP-01",
                osLabel = "Windows 11 · v2.4.1",
                host = "192.168.1.10",
                status = DeviceStatus.Online,
                channel = ConnectChannel.Lan,
                latencyMs = 28,
                connectedDuration = "00:23:15",
                cpu = "Intel Core i7-12700H",
                ram = "32GB RAM",
            ),
            DesktopDevice(
                id = "desk-02",
                name = "DESKTOP-02",
                osLabel = "Windows 11",
                host = "192.168.1.12",
                status = DeviceStatus.Online,
                channel = ConnectChannel.Lan,
                latencyMs = 35,
            ),
            DesktopDevice(
                id = "desk-03",
                name = "DESKTOP-03",
                osLabel = "Windows 10",
                host = "192.168.1.15",
                status = DeviceStatus.Offline,
                channel = ConnectChannel.Lan,
            ),
        )

    fun find(id: String): DesktopDevice? = all.firstOrNull { it.id == id }
}
