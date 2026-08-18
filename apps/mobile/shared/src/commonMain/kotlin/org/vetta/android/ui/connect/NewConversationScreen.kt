package org.vetta.android.ui.connect

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
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
import androidx.compose.ui.unit.dp
import org.vetta.android.domain.device.DesktopDevice
import org.vetta.android.domain.device.DeviceStatus
import org.vetta.android.ui.components.FilterChipRow
import org.vetta.android.ui.components.PrimaryBlackButton
import org.vetta.android.ui.components.SectionHeader
import org.vetta.android.ui.components.VettaCard
import org.vetta.android.ui.i18n.Str
import org.vetta.android.ui.theme.vettaExtra

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewConversationScreen(
    devices: List<DesktopDevice>,
    channelIndex: Int,
    onChannelChange: (Int) -> Unit,
    onBack: () -> Unit,
    onStartDesktop: (deviceId: String, syncHistory: Boolean, syncFiles: Boolean) -> Unit,
    onStartCloud: () -> Unit,
) {
    var selectedDeviceId by remember {
        mutableStateOf(devices.firstOrNull { it.status == DeviceStatus.Online }?.id)
    }
    var syncHistory by remember { mutableStateOf(true) }
    var syncFiles by remember { mutableStateOf(true) }
    val channels = listOf(Str.pairDesktop, Str.channelCloud)

    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(Str.newConversation, style = MaterialTheme.typography.titleMedium) },
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
            FilterChipRow(options = channels, selectedIndex = channelIndex.coerceIn(0, 1), onSelect = onChannelChange)
            Spacer(Modifier.height(16.dp))

            if (channelIndex == 1) {
                Text(
                    Str.featureCloudDesc,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.vettaExtra.secondaryText,
                )
                Spacer(Modifier.height(20.dp))
                PrimaryBlackButton(text = Str.startConversation, onClick = onStartCloud)
            } else {
                SectionHeader(title = Str.selectDevice)
                devices.forEach { device ->
                    val selected = device.id == selectedDeviceId
                    VettaCard(
                        modifier = Modifier.padding(vertical = 5.dp),
                        onClick = {
                            if (device.status == DeviceStatus.Online) selectedDeviceId = device.id
                        },
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Computer, contentDescription = null)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(device.name, style = MaterialTheme.typography.bodyLarge)
                                Text(
                                    "${if (device.status == DeviceStatus.Online) Str.online else Str.offline} · ${device.host}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.vettaExtra.secondaryText,
                                )
                            }
                            if (selected) {
                                Icon(
                                    Icons.Default.CheckCircle,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.onSurface,
                                )
                            }
                        }
                    }
                }

                Spacer(Modifier.height(16.dp))
                SectionHeader(title = Str.sessionSettings)
                VettaCard {
                    SettingToggle(Str.historySync, syncHistory) { syncHistory = it }
                    Spacer(Modifier.height(8.dp))
                    SettingToggle(Str.syncFilesContext, syncFiles) { syncFiles = it }
                }
                Spacer(Modifier.height(20.dp))
                PrimaryBlackButton(
                    text = Str.startConversation,
                    enabled = selectedDeviceId != null,
                    onClick = {
                        val id = selectedDeviceId ?: return@PrimaryBlackButton
                        onStartDesktop(id, syncHistory, syncFiles)
                    },
                )
            }
        }
    }
}

@Composable
private fun SettingToggle(
    label: String,
    checked: Boolean,
    onChecked: (Boolean) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChecked)
    }
}
