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
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.resources.Res
import org.vetta.android.resources.connect_title
import org.vetta.android.resources.connected
import org.vetta.android.resources.disconnected
import org.vetta.android.resources.my_devices
import org.vetta.android.resources.new_conversation
import org.vetta.android.resources.no_devices_hint
import org.vetta.android.resources.no_sessions_hint
import org.vetta.android.resources.quick_start
import org.vetta.android.resources.recent_sessions
import org.vetta.android.resources.tab_home
import org.vetta.android.resources.use_cloud_ai
import org.vetta.android.resources.view_all
import org.vetta.android.ui.i18n.relativeTimeLabel
import org.vetta.android.ui.i18n.sessionTitle
import org.vetta.android.ui.i18n.sourceText
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
                title = { Text(stringResource(Res.string.tab_home), style = MaterialTheme.typography.titleMedium) },
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
            SectionHeader(title = stringResource(Res.string.my_devices))
            if (primaryDevice != null) {
                VettaListGroup {
                    ListRow(
                        title = primaryDevice.name,
                        subtitle =
                            "${if (primaryDevice.status == DeviceStatus.Online) stringResource(Res.string.connected) else stringResource(Res.string.disconnected)} · " +
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
                    title = stringResource(Res.string.disconnected),
                    subtitle = stringResource(Res.string.no_devices_hint),
                    icon = Icons.Default.Computer,
                    actionLabel = stringResource(Res.string.connect_title),
                    onAction = onOpenDevices,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            Spacer(Modifier.height(20.dp))
            SectionHeader(
                title = stringResource(Res.string.recent_sessions),
                action = stringResource(Res.string.view_all),
                onAction = onOpenSessions,
            )
            if (recentSessions.isEmpty()) {
                Text(
                    stringResource(Res.string.no_sessions_hint),
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
            SectionHeader(title = stringResource(Res.string.quick_start))
            Spacer(Modifier.height(4.dp))
            PrimaryBlackButton(text = stringResource(Res.string.new_conversation), onClick = onNewConversation)
            Spacer(Modifier.height(10.dp))
            SecondaryOutlineButton(text = stringResource(Res.string.use_cloud_ai), onClick = onUseCloudAi)
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
        title = sessionTitle(item.title),
        subtitle = "${item.sourceText()} · ${relativeTimeLabel(item.updatedAtEpochMs)}",
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
