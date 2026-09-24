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
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.app.APP_VERSION
import org.vetta.android.resources.Res
import org.vetta.android.resources.about_description
import org.vetta.android.resources.about_section
import org.vetta.android.resources.about_us
import org.vetta.android.resources.about_vetta
import org.vetta.android.resources.account_and_devices
import org.vetta.android.resources.action_retry
import org.vetta.android.resources.app_name
import org.vetta.android.resources.appearance
import org.vetta.android.resources.appearance_hint
import org.vetta.android.resources.auto_resume
import org.vetta.android.resources.auto_resume_hint
import org.vetta.android.resources.back
import org.vetta.android.resources.behavior
import org.vetta.android.resources.clear_local_data
import org.vetta.android.resources.clear_local_data_action
import org.vetta.android.resources.clear_local_data_hint
import org.vetta.android.resources.clear_local_data_message
import org.vetta.android.resources.clear_local_data_title
import org.vetta.android.resources.confirm_delete_session
import org.vetta.android.resources.confirm_delete_session_hint
import org.vetta.android.resources.confirm_logout
import org.vetta.android.resources.connected_devices
import org.vetta.android.resources.data_section
import org.vetta.android.resources.general_settings
import org.vetta.android.resources.get_started
import org.vetta.android.resources.loading
import org.vetta.android.resources.login_to_view_plan
import org.vetta.android.resources.logout
import org.vetta.android.resources.logout_and_clear
import org.vetta.android.resources.logout_confirm
import org.vetta.android.resources.me
import org.vetta.android.resources.not_logged_in
import org.vetta.android.resources.open_source_licenses
import org.vetta.android.resources.open_source_licenses_body
import org.vetta.android.resources.page_motion
import org.vetta.android.resources.page_motion_hint
import org.vetta.android.resources.plan
import org.vetta.android.resources.plan_active
import org.vetta.android.resources.plan_disabled
import org.vetta.android.resources.plan_inactive
import org.vetta.android.resources.privacy_policy
import org.vetta.android.resources.privacy_policy_body
import org.vetta.android.resources.settings
import org.vetta.android.resources.theme_dark
import org.vetta.android.resources.theme_light
import org.vetta.android.resources.theme_system
import org.vetta.android.resources.version_number
import org.vetta.android.resources.window5h
import org.vetta.android.resources.window_month
import org.vetta.android.resources.window_week
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
    val name = user?.nickname?.ifBlank { user.username } ?: stringResource(Res.string.not_logged_in)
    val contact = user?.email ?: user?.phone ?: ""

    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(Res.string.me), style = MaterialTheme.typography.titleMedium) },
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
            SectionHeader(title = stringResource(Res.string.account_and_devices))
            VettaListGroup {
                ProfileRow(Icons.Default.Devices, stringResource(Res.string.connected_devices), "$onlineDeviceCount", onOpenDevices, showDivider = false)
            }

            Spacer(Modifier.height(16.dp))
            SectionHeader(title = stringResource(Res.string.settings))
            VettaListGroup {
                ProfileRow(Icons.Default.Settings, stringResource(Res.string.general_settings), null, onOpenSettings, showDivider = false)
            }

            Spacer(Modifier.height(16.dp))
            SectionHeader(title = stringResource(Res.string.plan))
            VettaListGroup(modifier = Modifier.clickable(onClick = onOpenPlan)) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        when {
                            subscription == null -> if (user == null) stringResource(Res.string.login_to_view_plan) else stringResource(Res.string.loading)
                            !subscription.goEnabled -> stringResource(Res.string.plan_disabled)
                            !subscription.active -> stringResource(Res.string.plan_inactive)
                            else -> "${stringResource(Res.string.plan_active)} · ${subscription.tierName ?: ""}"
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
            SectionHeader(title = stringResource(Res.string.about_section))
            VettaListGroup {
                ProfileRow(Icons.Default.Info, stringResource(Res.string.about_us), APP_VERSION, onOpenAbout, showDivider = false)
            }

            Spacer(Modifier.height(20.dp))
            if (user == null) {
                PrimaryBlackButton(text = stringResource(Res.string.get_started), onClick = onLogin)
            } else {
                PrimaryBlackButton(text = stringResource(Res.string.logout), onClick = { confirmLogout = true })
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (confirmLogout) {
        VettaChoiceDialog(
            title = stringResource(Res.string.logout),
            message = stringResource(Res.string.logout_confirm),
            primaryLabel = stringResource(Res.string.confirm_logout),
            onPrimary = {
                confirmLogout = false
                onLogout(false)
            },
            secondaryLabel = stringResource(Res.string.logout_and_clear),
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
                title = { Text(stringResource(Res.string.plan), style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.back))
                    }
                },
                actions = {
                    if (loggedIn) {
                        IconButton(onClick = onRefresh) {
                            Icon(Icons.Default.Refresh, contentDescription = stringResource(Res.string.action_retry))
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
                    title = stringResource(Res.string.login_to_view_plan),
                    actionLabel = stringResource(Res.string.get_started),
                    onAction = onLogin,
                    modifier = Modifier.fillMaxWidth(),
                )
                return@Column
            }
            VettaListGroup {
                Text(
                    when {
                        subscription == null -> stringResource(Res.string.loading)
                        !subscription.goEnabled -> stringResource(Res.string.plan_disabled)
                        !subscription.active -> stringResource(Res.string.plan_inactive)
                        else -> stringResource(Res.string.plan_active)
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
                                "5h" -> stringResource(Res.string.window5h)
                                "week" -> stringResource(Res.string.window_week)
                                "month" -> stringResource(Res.string.window_month)
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
                title = { Text(stringResource(Res.string.settings), style = MaterialTheme.typography.titleMedium) },
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
                .verticalScroll(rememberScrollState())
                .padding(start = 16.dp, top = 8.dp, end = 16.dp, bottom = 40.dp),
        ) {
            SectionHeader(title = stringResource(Res.string.appearance))
            Text(
                stringResource(Res.string.appearance_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.vettaExtra.secondaryText,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
            )
            Spacer(Modifier.height(10.dp))
            ThemeModeSelector(themeMode = themeMode, onThemeMode = onThemeMode)

            Spacer(Modifier.height(28.dp))
            SectionHeader(title = stringResource(Res.string.behavior))
            VettaListGroup {
                PreferenceSwitchRow(
                    title = stringResource(Res.string.auto_resume),
                    subtitle = stringResource(Res.string.auto_resume_hint),
                    checked = autoResumeLastSession,
                    onCheckedChange = onAutoResumeLastSession,
                    showDivider = true,
                )
                PreferenceSwitchRow(
                    title = stringResource(Res.string.page_motion),
                    subtitle = stringResource(Res.string.page_motion_hint),
                    checked = motionEnabled,
                    onCheckedChange = onMotionEnabled,
                    showDivider = false,
                )
            }

            Spacer(Modifier.height(28.dp))
            SectionHeader(title = stringResource(Res.string.data_section))
            VettaListGroup {
                ProfileRow(
                    Icons.Default.DeleteSweep,
                    stringResource(Res.string.clear_local_data),
                    null,
                    onClick = { confirmClearLocalData = true },
                    showDivider = true,
                    subtitle = stringResource(Res.string.clear_local_data_hint),
                )
                PreferenceSwitchRow(
                    title = stringResource(Res.string.confirm_delete_session),
                    subtitle = stringResource(Res.string.confirm_delete_session_hint),
                    checked = confirmBeforeDelete,
                    onCheckedChange = onConfirmBeforeDelete,
                    showDivider = false,
                )
            }

            Spacer(Modifier.height(28.dp))
            SectionHeader(title = stringResource(Res.string.about_section))
            VettaListGroup {
                ProfileRow(Icons.Default.Info, stringResource(Res.string.about_vetta), APP_VERSION, onOpenAbout, showDivider = false)
            }
        }
    }

    if (confirmClearLocalData) {
        VettaConfirmDialog(
            title = stringResource(Res.string.clear_local_data_title),
            message = stringResource(Res.string.clear_local_data_message),
            confirmLabel = stringResource(Res.string.clear_local_data_action),
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
            org.vetta.android.app.ThemeMode.System to stringResource(Res.string.theme_system),
            org.vetta.android.app.ThemeMode.Light to stringResource(Res.string.theme_light),
            org.vetta.android.app.ThemeMode.Dark to stringResource(Res.string.theme_dark),
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
                title = { Text(stringResource(Res.string.about_vetta), style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.back))
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
            BoxAvatar(stringResource(Res.string.app_name))
            Spacer(Modifier.height(16.dp))
            Text(stringResource(Res.string.app_name), style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(8.dp))
            Text(stringResource(Res.string.version_number, APP_VERSION), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
            Spacer(Modifier.height(24.dp))
            Text(stringResource(Res.string.about_description), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.vettaExtra.secondaryText)
            Spacer(Modifier.height(28.dp))
            VettaListGroup {
                ProfileRow(
                    Icons.Default.Info,
                    stringResource(Res.string.open_source_licenses),
                    null,
                    onClick = { openDocument = AboutDocument.Licenses },
                    showDivider = true,
                )
                ProfileRow(
                    Icons.Default.Info,
                    stringResource(Res.string.privacy_policy),
                    null,
                    onClick = { openDocument = AboutDocument.Privacy },
                    showDivider = false,
                )
            }
        }
    }

    openDocument?.let { document ->
        val title = if (document == AboutDocument.Licenses) stringResource(Res.string.open_source_licenses) else stringResource(Res.string.privacy_policy)
        val body = if (document == AboutDocument.Licenses) stringResource(Res.string.open_source_licenses_body) else stringResource(Res.string.privacy_policy_body)
        VettaInfoDialog(
            title = title,
            message = body,
            onDismiss = { openDocument = null },
        )
    }
}
