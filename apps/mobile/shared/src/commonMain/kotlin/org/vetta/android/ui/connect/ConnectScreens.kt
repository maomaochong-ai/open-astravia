package org.vetta.android.ui.connect

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import org.vetta.android.domain.device.DesktopDevice
import org.vetta.android.domain.device.DeviceStatus
import org.vetta.android.ui.components.FilterChipRow
import org.vetta.android.ui.components.PrimaryBlackButton
import org.vetta.android.ui.components.SectionHeader
import org.vetta.android.ui.components.StatusChip
import org.vetta.android.ui.components.StatusDot
import org.vetta.android.ui.components.VettaCard
import org.vetta.android.ui.i18n.Str
import org.vetta.android.ui.theme.vettaExtra

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
                    VettaCard {
                        Text(Str.channelCloud, style = MaterialTheme.typography.titleSmall)
                        Spacer(Modifier.height(6.dp))
                        Text(
                            Str.featureCloudDesc,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.vettaExtra.secondaryText,
                        )
                        Spacer(Modifier.height(14.dp))
                        PrimaryBlackButton(text = Str.useCloudAi, onClick = onUseCloud)
                    }
                }
                else -> {
                    SectionHeader(title = Str.lanDevices)
                    devices.forEach { device ->
                        VettaCard(
                            modifier = Modifier.padding(vertical = 5.dp),
                            onClick = { onOpenDevice(device.id) },
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Computer, contentDescription = null)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(device.name, style = MaterialTheme.typography.bodyLarge)
                                    Text(
                                        "${device.host} · ${if (device.status == DeviceStatus.Online) Str.online else Str.offline}",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.vettaExtra.secondaryText,
                                    )
                                }
                                StatusDot(online = device.status == DeviceStatus.Online)
                                Spacer(Modifier.width(8.dp))
                                Icon(
                                    Icons.Default.ChevronRight,
                                    contentDescription = null,
                                    tint = MaterialTheme.vettaExtra.secondaryText,
                                )
                            }
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    SectionHeader(title = Str.manualConnect)
                    OutlinedTextField(
                        value = host,
                        onValueChange = { host = it },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        placeholder = { Text(Str.hostPlaceholder) },
                        shape = MaterialTheme.shapes.medium,
                    )
                    Spacer(Modifier.height(10.dp))
                    PrimaryBlackButton(
                        text = Str.connectAction,
                        onClick = { onConnectManual(host.trim()) },
                        enabled = host.isNotBlank(),
                    )
                    TextButton(onClick = { }) {
                        Text(
                            Str.howToConnect,
                            color = MaterialTheme.vettaExtra.secondaryText,
                            style = MaterialTheme.typography.bodySmall,
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
    onOpenFiles: () -> Unit,
) {
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
                StatusChip(text = Str.deviceConnected, positive = device.status == DeviceStatus.Online)
                Spacer(Modifier.weight(1f))
            }
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Metric(Str.duration, device.connectedDuration ?: "—")
                Metric(Str.latency, device.latencyMs?.let { "${it}ms" } ?: "—")
            }
            Spacer(Modifier.height(12.dp))
            PrimaryBlackButton(text = Str.disconnect, onClick = onDisconnect)

            Spacer(Modifier.height(20.dp))
            SectionHeader(title = Str.desktopPreview)
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .aspectRatio(16f / 10f)
                        .clip(RoundedCornerShape(16.dp))
                        .background(
                            Brush.linearGradient(
                                listOf(Color(0xFF1A1A1A), Color(0xFF3A3A3C), Color(0xFF111111)),
                            ),
                        ),
                contentAlignment = Alignment.Center,
            ) {
                Text("Desktop", color = Color.White.copy(alpha = 0.7f))
            }

            Spacer(Modifier.height(20.dp))
            SectionHeader(title = Str.systemInfo)
            VettaCard {
                Text(device.osLabel, style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(6.dp))
                Text(device.cpu ?: "—", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
                Text(device.ram ?: "—", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
                Text(device.host, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
            }

            Spacer(Modifier.height(20.dp))
            SectionHeader(title = Str.quickActions)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                QuickAction(Icons.Default.UploadFile, Str.sendFile, onOpenFiles)
                QuickAction(Icons.Default.ContentCopy, Str.clipboard) {}
                QuickAction(Icons.Default.Terminal, Str.terminal) {}
                QuickAction(Icons.Default.PowerSettingsNew, Str.power) {}
            }
            Spacer(Modifier.height(20.dp))
            PrimaryBlackButton(text = Str.startConversation, onClick = onNewChat)
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
private fun QuickAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier =
            Modifier
                .width(72.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(MaterialTheme.colorScheme.surface)
                .padding(vertical = 12.dp)
                .let { it },
    ) {
        IconButton(onClick = onClick) {
            Icon(icon, contentDescription = label)
        }
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.vettaExtra.secondaryText)
    }
}
