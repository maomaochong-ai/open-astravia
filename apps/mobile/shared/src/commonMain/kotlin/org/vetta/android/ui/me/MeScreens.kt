package org.vetta.android.ui.me

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.toggleable
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
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import org.vetta.android.core.model.SubscriptionStatus
import org.vetta.android.core.model.User
import org.vetta.android.ui.components.PrimaryBlackButton
import org.vetta.android.ui.components.EmptyState
import org.vetta.android.ui.components.QuotaMeter
import org.vetta.android.ui.components.SectionHeader
import org.vetta.android.ui.components.VettaListGroup
import org.vetta.android.ui.components.VettaConfirmDialog
import org.vetta.android.ui.components.VettaChoiceDialog
import org.vetta.android.ui.components.VettaInfoDialog
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
    onOpenAbout: () -> Unit,
    onLogin: () -> Unit,
    onLogout: (clearLocal: Boolean) -> Unit,
) {
    var confirmLogout by remember { mutableStateOf(false) }
    val name = user?.nickname?.ifBlank { user.username } ?: Str.notLoggedIn
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
                .padding(start = 16.dp, top = 8.dp, end = 16.dp, bottom = 40.dp),
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
            VettaListGroup {
                ProfileRow(Icons.Default.Devices, Str.connectedDevices, "$onlineDeviceCount", onOpenDevices, showDivider = false)
            }

            Spacer(Modifier.height(16.dp))
            SectionHeader(title = Str.settings)
            VettaListGroup {
                ProfileRow(Icons.Default.Settings, Str.generalSettings, null, onOpenSettings, showDivider = false)
            }

            Spacer(Modifier.height(16.dp))
            SectionHeader(title = Str.plan)
            VettaListGroup(modifier = Modifier.clickable(onClick = onOpenPlan)) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        when {
                            subscription == null -> if (user == null) Str.loginToViewPlan else Str.loading
                            !subscription.goEnabled -> Str.planDisabled
                            !subscription.active -> Str.planInactive
                            else -> "${Str.planActive} · ${subscription.tierName ?: ""}"
                        },
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.weight(1f),
                    )
                    Icon(
                        Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = null,
                        tint = MaterialTheme.vettaExtra.secondaryText,
                    )
                }
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
            VettaListGroup {
                ProfileRow(Icons.Default.Info, Str.aboutUs, Str.versionNumber.removePrefix("版本 "), onOpenAbout, showDivider = false)
            }

            Spacer(Modifier.height(20.dp))
            if (user == null) {
                PrimaryBlackButton(text = Str.getStarted, onClick = onLogin)
            } else {
                PrimaryBlackButton(text = Str.logout, onClick = { confirmLogout = true })
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (confirmLogout) {
        VettaChoiceDialog(
            title = Str.logout,
            message = Str.logoutConfirm,
            primaryLabel = Str.confirmLogout,
            onPrimary = {
                confirmLogout = false
                onLogout(false)
            },
            secondaryLabel = Str.logoutAndClear,
            onSecondary = {
                confirmLogout = false
                onLogout(true)
            },
            onDismiss = { confirmLogout = false },
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
    onClick: (() -> Unit)?,
    showDivider: Boolean = true,
    subtitle: String? = null,
) {
    val rowModifier =
        Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(vertical = 14.dp)
    Row(
        modifier = rowModifier,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurface)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (!subtitle.isNullOrBlank()) {
                Spacer(Modifier.height(2.dp))
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.vettaExtra.secondaryText,
                )
            }
        }
        if (!value.isNullOrBlank()) {
            Text(value, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
            Spacer(Modifier.width(4.dp))
        }
        if (onClick != null) {
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.vettaExtra.secondaryText,
            )
        }
    }
    if (showDivider) {
        androidx.compose.material3.HorizontalDivider(color = MaterialTheme.vettaExtra.border)
    }
}

private enum class AboutDocument {
    Licenses,
    Privacy,
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlanScreen(
    subscription: SubscriptionStatus?,
    loggedIn: Boolean,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onLogin: () -> Unit,
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
                    if (loggedIn) {
                        IconButton(onClick = onRefresh) {
                            Icon(Icons.Default.Refresh, contentDescription = Str.actionRetry)
                        }
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
            if (!loggedIn) {
                EmptyState(
                    title = Str.loginToViewPlan,
                    actionLabel = Str.getStarted,
                    onAction = onLogin,
                    modifier = Modifier.fillMaxWidth(),
                )
                return@Column
            }
            VettaListGroup {
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
                VettaListGroup(modifier = Modifier.padding(vertical = 10.dp)) {
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
    autoResumeLastSession: Boolean,
    motionEnabled: Boolean,
    onThemeMode: (org.vetta.android.app.ThemeMode) -> Unit,
    onAutoResumeLastSession: (Boolean) -> Unit,
    onMotionEnabled: (Boolean) -> Unit,
    onClearLocalData: () -> Unit,
    onOpenAbout: () -> Unit,
    onBack: () -> Unit,
    confirmBeforeDelete: Boolean,
    onConfirmBeforeDelete: (Boolean) -> Unit,
) {
    var confirmClearLocalData by remember { mutableStateOf(false) }
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
                .padding(start = 16.dp, top = 8.dp, end = 16.dp, bottom = 40.dp),
        ) {
            SectionHeader(title = Str.appearance)
            Text(
                Str.appearanceHint,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.vettaExtra.secondaryText,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
            )
            Spacer(Modifier.height(10.dp))
            ThemeModeSelector(themeMode = themeMode, onThemeMode = onThemeMode)

            Spacer(Modifier.height(28.dp))
            SectionHeader(title = Str.behavior)
            VettaListGroup {
                PreferenceSwitchRow(
                    title = Str.autoResume,
                    subtitle = Str.autoResumeHint,
                    checked = autoResumeLastSession,
                    onCheckedChange = onAutoResumeLastSession,
                    showDivider = true,
                )
                PreferenceSwitchRow(
                    title = Str.pageMotion,
                    subtitle = Str.pageMotionHint,
                    checked = motionEnabled,
                    onCheckedChange = onMotionEnabled,
                    showDivider = false,
                )
            }

            Spacer(Modifier.height(28.dp))
            SectionHeader(title = Str.dataSection)
            VettaListGroup {
                ProfileRow(
                    Icons.Default.DeleteSweep,
                    Str.clearLocalData,
                    null,
                    onClick = { confirmClearLocalData = true },
                    showDivider = true,
                    subtitle = Str.clearLocalDataHint,
                )
                PreferenceSwitchRow(
                    title = Str.confirmDeleteSession,
                    subtitle = Str.confirmDeleteSessionHint,
                    checked = confirmBeforeDelete,
                    onCheckedChange = onConfirmBeforeDelete,
                    showDivider = false,
                )
            }

            Spacer(Modifier.height(28.dp))
            SectionHeader(title = Str.aboutSection)
            VettaListGroup {
                ProfileRow(Icons.Default.Info, Str.aboutVetta, Str.versionNumber.removePrefix("版本 "), onOpenAbout, showDivider = false)
            }
        }
    }

    if (confirmClearLocalData) {
        VettaConfirmDialog(
            title = Str.clearLocalDataTitle,
            message = Str.clearLocalDataMessage,
            confirmLabel = Str.clearLocalDataAction,
            onConfirm = {
                confirmClearLocalData = false
                onClearLocalData()
            },
            onDismiss = { confirmClearLocalData = false },
        )
    }
}

@Composable
private fun ThemeModeSelector(
    themeMode: org.vetta.android.app.ThemeMode,
    onThemeMode: (org.vetta.android.app.ThemeMode) -> Unit,
) {
    val modes =
        listOf(
            org.vetta.android.app.ThemeMode.System to Str.themeSystem,
            org.vetta.android.app.ThemeMode.Light to Str.themeLight,
            org.vetta.android.app.ThemeMode.Dark to Str.themeDark,
        )
    androidx.compose.foundation.layout.Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp),
    ) {
        modes.forEach { (mode, label) ->
            val selected = themeMode == mode
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
                color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                modifier =
                    Modifier
                        .weight(1f)
                        .clip(MaterialTheme.shapes.medium)
                        .background(if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.vettaExtra.chipBackground)
                        .clickable { onThemeMode(mode) }
                        .padding(vertical = 13.dp),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
}

@Composable
private fun PreferenceSwitchRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    showDivider: Boolean,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .toggleable(
                    value = checked,
                    role = Role.Switch,
                    onValueChange = onCheckedChange,
                )
                .padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(2.dp))
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
        }
        androidx.compose.material3.Switch(checked = checked, onCheckedChange = null)
    }
    if (showDivider) {
        androidx.compose.material3.HorizontalDivider(color = MaterialTheme.vettaExtra.border)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AboutScreen(onBack: () -> Unit) {
    var openDocument by remember { mutableStateOf<AboutDocument?>(null) }
    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(Str.aboutVetta, style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = Str.back)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.vettaExtra.pageBackground),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 24.dp, top = 36.dp, end = 24.dp, bottom = 40.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            BoxAvatar(Str.appName)
            Spacer(Modifier.height(16.dp))
            Text(Str.appName, style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(8.dp))
            Text(Str.versionNumber, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
            Spacer(Modifier.height(24.dp))
            Text(Str.aboutDescription, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.vettaExtra.secondaryText)
            Spacer(Modifier.height(28.dp))
            VettaListGroup {
                ProfileRow(
                    Icons.Default.Info,
                    Str.openSourceLicenses,
                    null,
                    onClick = { openDocument = AboutDocument.Licenses },
                    showDivider = true,
                )
                ProfileRow(
                    Icons.Default.Info,
                    Str.privacyPolicy,
                    null,
                    onClick = { openDocument = AboutDocument.Privacy },
                    showDivider = false,
                )
            }
        }
    }

    openDocument?.let { document ->
        val title = if (document == AboutDocument.Licenses) Str.openSourceLicenses else Str.privacyPolicy
        val body = if (document == AboutDocument.Licenses) Str.openSourceLicensesBody else Str.privacyPolicyBody
        VettaInfoDialog(
            title = title,
            message = body,
            onDismiss = { openDocument = null },
        )
    }
}
