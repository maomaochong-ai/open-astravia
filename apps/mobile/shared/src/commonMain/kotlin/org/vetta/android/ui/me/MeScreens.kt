package org.vetta.android.ui.me

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.HelpOutline
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.NotificationsNone
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import org.vetta.android.core.model.SubscriptionStatus
import org.vetta.android.core.model.User
import org.vetta.android.ui.components.PrimaryBlackButton
import org.vetta.android.ui.components.QuotaMeter
import org.vetta.android.ui.components.SectionHeader
import org.vetta.android.ui.components.VettaCard
import org.vetta.android.ui.i18n.Str
import org.vetta.android.ui.theme.vettaExtra

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MeScreen(
    user: User?,
    subscription: SubscriptionStatus?,
    onlineDeviceCount: Int,
    onOpenPlan: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenDevices: () -> Unit,
    onLogout: (clearLocal: Boolean) -> Unit,
) {
    var confirmLogout by remember { mutableStateOf(false) }
    val name = user?.nickname?.ifBlank { user.username } ?: "—"
    val contact = user?.email ?: user?.phone ?: ""

    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(Str.me, style = MaterialTheme.typography.titleMedium) },
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
                BoxAvatar(name)
                Spacer(Modifier.width(14.dp))
                Column {
                    Text(name, style = MaterialTheme.typography.titleMedium)
                    if (contact.isNotBlank()) {
                        Text(
                            contact,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.vettaExtra.secondaryText,
                        )
                    }
                }
            }

            Spacer(Modifier.height(20.dp))
            SectionHeader(title = Str.accountAndDevices)
            VettaCard {
                ProfileRow(Icons.Default.Devices, Str.connectedDevices, "$onlineDeviceCount", onOpenDevices)
                ProfileRow(Icons.Default.VerifiedUser, Str.authManagement, null) { }
            }

            Spacer(Modifier.height(16.dp))
            SectionHeader(title = Str.settings)
            VettaCard {
                ProfileRow(Icons.Default.NotificationsNone, Str.notificationSettings, null) { }
                ProfileRow(Icons.Default.Lock, Str.privacySecurity, null) { }
                ProfileRow(Icons.Default.Settings, Str.generalSettings, null, onOpenSettings)
            }

            Spacer(Modifier.height(16.dp))
            SectionHeader(title = Str.plan)
            VettaCard(onClick = onOpenPlan) {
                Text(
                    when {
                        subscription == null -> Str.loading
                        !subscription.goEnabled -> Str.planDisabled
                        !subscription.active -> Str.planInactive
                        else -> "${Str.planActive} · ${subscription.tierName ?: ""}"
                    },
                    style = MaterialTheme.typography.bodyLarge,
                )
                subscription?.windows?.firstOrNull()?.let { w ->
                    Spacer(Modifier.height(10.dp))
                    QuotaMeter(
                        label = w.kind,
                        limit = w.limit,
                        consumed = w.consumed,
                        resetAt = w.resetAt,
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            SectionHeader(title = Str.aboutSection)
            VettaCard {
                ProfileRow(Icons.Default.HelpOutline, Str.helpFeedback, null) { }
                ProfileRow(Icons.Default.Info, Str.aboutUs, "0.1.0") { }
            }

            Spacer(Modifier.height(20.dp))
            PrimaryBlackButton(text = Str.logout, onClick = { confirmLogout = true })
            Spacer(Modifier.height(24.dp))
        }
    }

    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text(Str.logout) },
            text = { Text(Str.logoutConfirm) },
            confirmButton = {
                Button(
                    onClick = {
                        confirmLogout = false
                        onLogout(false)
                    },
                ) { Text(Str.logout) }
            },
            dismissButton = {
                Column {
                    TextButton(
                        onClick = {
                            confirmLogout = false
                            onLogout(true)
                        },
                    ) { Text(Str.logoutAndClear) }
                    TextButton(onClick = { confirmLogout = false }) { Text(Str.cancel) }
                }
            },
        )
    }
}

@Composable
private fun BoxAvatar(name: String) {
    val letter = name.firstOrNull()?.uppercaseChar()?.toString() ?: "V"
    Box(
        modifier =
            Modifier
                .size(56.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primary),
        contentAlignment = Alignment.Center,
    ) {
        Text(letter, color = MaterialTheme.colorScheme.onPrimary, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun ProfileRow(
    icon: ImageVector,
    title: String,
    value: String?,
    onClick: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurface)
        Spacer(Modifier.width(12.dp))
        Text(title, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        if (!value.isNullOrBlank()) {
            Text(value, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
            Spacer(Modifier.width(4.dp))
        }
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.vettaExtra.secondaryText,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlanScreen(
    subscription: SubscriptionStatus?,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
) {
    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(Str.plan, style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = Str.back)
                    }
                },
                actions = {
                    TextButton(onClick = onRefresh) { Text(Str.actionRetry) }
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
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            VettaCard {
                Text(
                    when {
                        subscription == null -> Str.loading
                        !subscription.goEnabled -> Str.planDisabled
                        !subscription.active -> Str.planInactive
                        else -> Str.planActive
                    },
                    style = MaterialTheme.typography.titleMedium,
                )
                if (subscription?.tierName != null) {
                    Spacer(Modifier.height(6.dp))
                    Text(subscription.tierName, style = MaterialTheme.typography.bodyLarge)
                }
                if (!subscription?.description.isNullOrBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        subscription.description.orEmpty(),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.vettaExtra.secondaryText,
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
            subscription?.windows.orEmpty().forEach { w ->
                VettaCard(modifier = Modifier.padding(vertical = 4.dp)) {
                    QuotaMeter(
                        label =
                            when (w.kind) {
                                "5h" -> Str.window5h
                                "week" -> Str.windowWeek
                                "month" -> Str.windowMonth
                                else -> w.kind
                            },
                        limit = w.limit,
                        consumed = w.consumed,
                        resetAt = w.resetAt,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    themeMode: org.vetta.android.app.ThemeMode,
    serverUrl: String,
    onThemeMode: (org.vetta.android.app.ThemeMode) -> Unit,
    onOpenServer: () -> Unit,
    onBack: () -> Unit,
) {
    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(Str.settings, style = MaterialTheme.typography.titleMedium) },
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
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            SectionHeader(title = Str.appearance)
            VettaCard {
                org.vetta.android.app.ThemeMode.entries.forEach { mode ->
                    val label =
                        when (mode) {
                            org.vetta.android.app.ThemeMode.System -> Str.themeSystem
                            org.vetta.android.app.ThemeMode.Light -> Str.themeLight
                            org.vetta.android.app.ThemeMode.Dark -> Str.themeDark
                        }
                    ProfileRow(
                        icon = Icons.Default.Settings,
                        title = label,
                        value = if (themeMode == mode) "✓" else null,
                        onClick = { onThemeMode(mode) },
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
            SectionHeader(title = Str.server)
            VettaCard {
                ProfileRow(
                    icon = Icons.Default.Settings,
                    title = Str.serverUrl,
                    value = serverUrl.takeLast(18),
                    onClick = onOpenServer,
                )
            }
        }
    }
}
