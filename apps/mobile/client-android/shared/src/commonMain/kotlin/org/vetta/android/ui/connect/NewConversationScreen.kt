package org.vetta.android.ui.connect

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
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
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.vetta.android.domain.device.DesktopDevice
import org.vetta.android.domain.device.DeviceStatus
import org.vetta.android.ui.components.FilterChipRow
import org.vetta.android.ui.components.EmptyState
import org.vetta.android.ui.components.PrimaryBlackButton
import org.vetta.android.ui.components.SectionHeader
import org.vetta.android.ui.components.ListRow
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.resources.Res
import org.vetta.android.resources.back
import org.vetta.android.resources.channel_cloud
import org.vetta.android.resources.connect_desktop
import org.vetta.android.resources.feature_cloud_desc
import org.vetta.android.resources.new_conversation
import org.vetta.android.resources.no_available_desktop
import org.vetta.android.resources.no_available_desktop_hint
import org.vetta.android.resources.offline
import org.vetta.android.resources.online
import org.vetta.android.resources.pair_desktop
import org.vetta.android.resources.select_device
import org.vetta.android.resources.start_conversation
import org.vetta.android.ui.theme.vettaExtra

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewConversationScreen(
    devices: List<DesktopDevice>,
    channelIndex: Int,
    onChannelChange: (Int) -> Unit,
    onBack: () -> Unit,
    onStartDesktop: (deviceId: String) -> Unit,
    onStartCloud: () -> Unit,
    onConnectDesktop: () -> Unit,
) {
    var selectedDeviceId by remember(devices) {
        mutableStateOf(devices.firstOrNull { it.status == DeviceStatus.Online }?.id)
    }
    val channels = listOf(stringResource(Res.string.pair_desktop), stringResource(Res.string.channel_cloud))

    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(Res.string.new_conversation), style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.back))
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
                    stringResource(Res.string.feature_cloud_desc),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.vettaExtra.secondaryText,
                )
                Spacer(Modifier.height(20.dp))
                PrimaryBlackButton(text = stringResource(Res.string.start_conversation), onClick = onStartCloud)
            } else {
                SectionHeader(title = stringResource(Res.string.select_device))
                if (devices.none { it.status == DeviceStatus.Online }) {
                    EmptyState(
                        title = stringResource(Res.string.no_available_desktop),
                        subtitle = stringResource(Res.string.no_available_desktop_hint),
                        icon = Icons.Default.Computer,
                        actionLabel = stringResource(Res.string.connect_desktop),
                        onAction = onConnectDesktop,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 320.dp),
                    )
                } else {
                    devices.forEachIndexed { index, device ->
                        val selected = device.id == selectedDeviceId
                        ListRow(
                            title = device.name,
                            subtitle = if (device.status == DeviceStatus.Online) stringResource(Res.string.online) else stringResource(Res.string.offline),
                            leading = { Icon(Icons.Default.Computer, contentDescription = null) },
                            trailing = {
                                if (selected) {
                                    Icon(
                                        Icons.Default.CheckCircle,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.onSurface,
                                    )
                                }
                            },
                            onClick = {
                                if (device.status == DeviceStatus.Online) selectedDeviceId = device.id
                            },
                            showDivider = index < devices.lastIndex,
                        )
                    }

                    Spacer(Modifier.height(20.dp))
                    PrimaryBlackButton(
                        text = stringResource(Res.string.start_conversation),
                        enabled = selectedDeviceId != null,
                        onClick = {
                            val id = selectedDeviceId ?: return@PrimaryBlackButton
                            onStartDesktop(id)
                        },
                    )
                }
            }
        }
    }
}
