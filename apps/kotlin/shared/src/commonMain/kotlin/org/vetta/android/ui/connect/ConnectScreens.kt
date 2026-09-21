package org.vetta.android.ui.connect

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import org.vetta.android.domain.device.DesktopDevice
import org.vetta.android.domain.device.DeviceStatus
import org.vetta.android.domain.remote.remoteDesktopViewerTarget
import org.vetta.android.ui.components.FilterChipRow
import org.vetta.android.ui.components.EmptyState
import org.vetta.android.ui.components.ListRow
import org.vetta.android.ui.components.PrimaryBlackButton
import org.vetta.android.ui.components.SectionHeader
import org.vetta.android.ui.components.StatusChip
import org.vetta.android.ui.components.StatusDot
import org.vetta.android.ui.components.VettaTextField
import org.vetta.android.ui.components.VettaListGroup
import org.vetta.android.ui.i18n.Str
import org.vetta.android.ui.theme.vettaExtra
import org.vetta.android.ui.remote.RemoteDesktopSurface
import org.vetta.android.ui.remote.PairingScannerButton

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DiscoverConnectScreen(
    devices: List<DesktopDevice>,
    channelIndex: Int,
    onChannelChange: (Int) -> Unit,
    onOpenDevice: (String) -> Unit,
    onConnectManual: (String) -> Unit,
    onUseCloud: () -> Unit,
) {
    var host by remember { mutableStateOf("") }
    val channels = listOf(Str.channelLan, Str.channelRemote, Str.channelCloud)

    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(Str.discoverTitle, style = MaterialTheme.typography.titleMedium) },
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.vettaExtra.pageBackground,
                    ),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
        ) {
            Text(
                Str.discoverSubtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.vettaExtra.secondaryText,
            )
            Spacer(Modifier.height(14.dp))
            FilterChipRow(options = channels, selectedIndex = channelIndex, onSelect = onChannelChange)
            Spacer(Modifier.height(16.dp))

            when (channelIndex) {
                2 -> {
                    SectionHeader(title = Str.channelCloud)
                    Text(
                        Str.featureCloudDesc,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.vettaExtra.secondaryText,
                        modifier = Modifier.padding(horizontal = 4.dp),
                    )
                    Spacer(Modifier.height(18.dp))
                    PrimaryBlackButton(text = Str.useCloudAi, onClick = onUseCloud)
                }
                else -> {
                    val remote = channelIndex == 1
                    SectionHeader(
                        title =
                            if (remote) {
                                if (devices.isEmpty()) Str.remoteDesktopSection else Str.connectedDesktop
                            } else {
                                Str.lanDevices
                            },
                    )
                    if (remote) {
                        PairingScannerButton(
                            onScanned = onConnectManual,
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            label = Str.scanDesktop,
                        )
                        Spacer(Modifier.height(12.dp))
                    }
                    if (devices.isEmpty()) {
                        EmptyState(
                            title = if (remote) Str.noRemoteDevices else Str.disconnected,
                            subtitle = if (remote) Str.noRemoteDevicesHint else Str.noDevicesHint,
                            icon = Icons.Default.Computer,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    devices.forEachIndexed { index, device ->
                        ListRow(
                            title = device.name,
                            subtitle =
                                "${if (remote) Str.remoteDesktop else Str.lanDesktop} · " +
                                    if (device.status == DeviceStatus.Online) Str.online else Str.offline,
                            leading = { Icon(Icons.Default.Computer, contentDescription = null) },
                            trailing = {
                                StatusDot(online = device.status == DeviceStatus.Online)
                                Spacer(Modifier.width(12.dp))
                                Icon(Icons.Default.ChevronRight, contentDescription = null, tint = MaterialTheme.vettaExtra.secondaryText)
                            },
                            onClick = { onOpenDevice(device.id) },
                            showDivider = index < devices.lastIndex,
                        )
                    }
                    Spacer(Modifier.height(22.dp))
                    if (!remote) {
                        SectionHeader(title = Str.manualConnect)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            VettaTextField(
                                value = host,
                                onValueChange = { host = it },
                                modifier = Modifier.weight(1f),
                                singleLine = true,
                                placeholder = { Text(Str.lanAddressHint) },
                            )
                            Spacer(Modifier.width(6.dp))
                            PairingScannerButton(onScanned = { value -> host = value })
                        }
                        Spacer(Modifier.height(10.dp))
                        PrimaryBlackButton(
                            text = Str.connectAction,
                            onClick = { onConnectManual(host.trim()) },
                            enabled = host.isNotBlank(),
                        )
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeviceDetailScreen(
    device: DesktopDevice,
    onBack: () -> Unit,
    onDisconnect: () -> Unit,
    onNewChat: () -> Unit,
) {
    val statusLabel =
        when (device.status) {
            DeviceStatus.Online -> Str.deviceConnected
            DeviceStatus.Connecting -> Str.connectingDesktop
            DeviceStatus.Offline -> Str.disconnected
        }
    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(device.name, style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = Str.back)
                    }
                },
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.vettaExtra.pageBackground,
                    ),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusChip(text = statusLabel, positive = device.status == DeviceStatus.Online)
                Spacer(Modifier.weight(1f))
            }
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Metric(Str.duration, device.connectedDuration ?: Str.notAvailable)
                Metric(Str.latency, device.latencyMs?.let { "${it}ms" } ?: Str.notAvailable)
            }
            Spacer(Modifier.height(12.dp))
            PrimaryBlackButton(text = Str.disconnect, onClick = onDisconnect)

            val desktopTarget = remoteDesktopViewerTarget(device.host)
            AnimatedVisibility(
                visible = desktopTarget != null,
                enter = fadeIn(),
                exit = fadeOut(),
            ) {
                desktopTarget?.let {
                    Column {
                        Spacer(Modifier.height(20.dp))
                        SectionHeader(title = Str.desktopPreview)
                        RemoteDesktopSurface(
                            target = it.url,
                            modifier = Modifier.fillMaxWidth().height(180.dp).clip(RoundedCornerShape(8.dp)),
                        )
                    }
                }
            }

            Spacer(Modifier.height(20.dp))
            SectionHeader(title = Str.systemInfo)
            VettaListGroup {
                SystemInfoRow(Str.operatingSystem, device.osLabel)
                SystemInfoRow(Str.processor, device.cpu)
                SystemInfoRow(Str.memory, device.ram)
            }

            Spacer(Modifier.height(20.dp))
            PrimaryBlackButton(
                text = Str.startConversation,
                onClick = onNewChat,
                enabled = device.status == DeviceStatus.Online,
            )
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun Metric(label: String, value: String) {
    Column {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
        Text(value, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun SystemInfoRow(label: String, value: String?) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
        Text(value ?: Str.notAvailable, style = MaterialTheme.typography.bodySmall)
    }
}
