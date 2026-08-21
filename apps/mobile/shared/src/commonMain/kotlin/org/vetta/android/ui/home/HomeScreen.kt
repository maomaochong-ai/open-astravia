package org.vetta.android.ui.home

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.vetta.android.domain.device.DesktopDevice
import org.vetta.android.domain.device.DeviceStatus
import org.vetta.android.domain.device.SessionListItem
import org.vetta.android.ui.components.PrimaryBlackButton
import org.vetta.android.ui.components.SecondaryOutlineButton
import org.vetta.android.ui.components.SectionHeader
import org.vetta.android.ui.components.StatusDot
import org.vetta.android.ui.components.ListRow
import org.vetta.android.ui.components.VettaListGroup
import org.vetta.android.ui.components.EmptyState
import org.vetta.android.ui.i18n.Str
import org.vetta.android.ui.theme.vettaExtra

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    primaryDevice: DesktopDevice?,
    recentSessions: List<SessionListItem>,
    onOpenDevice: (String) -> Unit,
    onOpenDevices: () -> Unit,
    onOpenSessions: () -> Unit,
    onOpenSession: (String) -> Unit,
    onNewConversation: () -> Unit,
    onUseCloudAi: () -> Unit,
) {
    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(Str.tabHome, style = MaterialTheme.typography.titleMedium) },
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
                .padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            SectionHeader(title = Str.myDevices)
            if (primaryDevice != null) {
                VettaListGroup {
                    ListRow(
                        title = primaryDevice.name,
                        subtitle =
                            "${if (primaryDevice.status == DeviceStatus.Online) Str.connected else Str.disconnected} · " +
                                primaryDevice.osLabel,
                        leading = { Icon(Icons.Default.Computer, contentDescription = null, modifier = Modifier.size(24.dp)) },
                        trailing = {
                            StatusDot(online = primaryDevice.status == DeviceStatus.Online)
                            Spacer(Modifier.width(12.dp))
                            Icon(
                                Icons.Default.ChevronRight,
                                contentDescription = null,
                                tint = MaterialTheme.vettaExtra.secondaryText,
                            )
                        },
                        onClick = { onOpenDevice(primaryDevice.id) },
                        showDivider = false,
                    )
                }
            } else {
                EmptyState(
                    title = Str.disconnected,
                    subtitle = Str.noDevicesHint,
                    icon = Icons.Default.Computer,
                    actionLabel = Str.connectTitle,
                    onAction = onOpenDevices,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            Spacer(Modifier.height(20.dp))
            SectionHeader(
                title = Str.recentSessions,
                action = Str.viewAll,
                onAction = onOpenSessions,
            )
            if (recentSessions.isEmpty()) {
                Text(
                    Str.noSessionsHint,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.vettaExtra.secondaryText,
                    modifier = Modifier.padding(vertical = 12.dp),
                )
            } else {
                recentSessions.take(5).forEachIndexed { index, item ->
                    SessionMiniRow(
                        item = item,
                        onClick = { onOpenSession(item.id) },
                        showDivider = index < recentSessions.take(5).lastIndex,
                    )
                }
            }

            Spacer(Modifier.height(20.dp))
            SectionHeader(title = Str.quickStart)
            Spacer(Modifier.height(4.dp))
            PrimaryBlackButton(text = Str.newConversation, onClick = onNewConversation)
            Spacer(Modifier.height(10.dp))
            SecondaryOutlineButton(text = Str.useCloudAi, onClick = onUseCloudAi)
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun SessionMiniRow(
    item: SessionListItem,
    onClick: () -> Unit,
    showDivider: Boolean,
) {
    ListRow(
        title = item.title,
        subtitle = "${item.sourceLabel} · ${item.timeLabel}",
        leading = { StatusDot(online = !item.isCloud) },
        trailing = {
            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.vettaExtra.secondaryText,
            )
        },
        onClick = onClick,
        showDivider = showDivider,
    )
}
