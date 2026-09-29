package org.vetta.android.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Laptop
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.pluralStringResource
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.app.APP_VERSION
import org.vetta.android.app.ThemeMode
import org.vetta.android.domain.remote.link.LinkIndicator
import org.vetta.android.domain.work.MirrorPreferences
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.resources.Res
import org.vetta.android.resources.appearance
import org.vetta.android.resources.back
import org.vetta.android.resources.latency
import org.vetta.android.resources.link_latency
import org.vetta.android.resources.notify_settings
import org.vetta.android.resources.remote_control
import org.vetta.android.resources.settings_background_link
import org.vetta.android.resources.settings_background_link_denied
import org.vetta.android.resources.settings_background_link_hint
import org.vetta.android.resources.settings_title
import org.vetta.android.resources.theme_dark
import org.vetta.android.resources.theme_light
import org.vetta.android.resources.theme_system
import org.vetta.android.resources.version_number
import org.vetta.android.resources.work_settings_haptics
import org.vetta.android.resources.work_settings_live_thinking
import org.vetta.android.resources.work_settings_load
import org.vetta.android.resources.work_settings_load_idle
import org.vetta.android.resources.work_settings_load_value
import org.vetta.android.resources.work_settings_online
import org.vetta.android.resources.work_settings_rescan
import org.vetta.android.resources.work_settings_scan
import org.vetta.android.resources.work_settings_unpair
import org.vetta.android.resources.work_settings_unpair_confirm
import org.vetta.android.resources.work_settings_unpair_hint
import org.vetta.android.ui.components.VettaConfirmDialog
import org.vetta.android.ui.design.GlassCircleButton
import org.vetta.android.ui.theme.vettaExtra
import org.vetta.android.ui.work.describe
import org.vetta.android.ui.work.linkDetail
import org.vetta.android.ui.work.workColors

/**
 * The paired computer and how the phone works with it (the iPhone's `SettingsView`),
 * grouped like system settings: the computer and its link, when to confirm on the phone,
 * what the chat shows, the app's appearance, and unpairing; and the way to the computer's screen.
 */
@Composable
fun SettingsScreen(
    state: MirrorState,
    themeMode: ThemeMode,
    onThemeMode: (ThemeMode) -> Unit,
    onPreferences: ((MirrorPreferences) -> MirrorPreferences) -> Unit,
    onUnpair: () -> Unit,
    onPair: () -> Unit,
    onBack: () -> Unit,
    backgroundLink: Boolean = false,
    onBackgroundLink: (Boolean) -> Unit = {},
    /** Opens the computer's screen; null where it cannot be reached that way. */
    onOpenRemote: (() -> Unit)? = null,
    /** Opens the page choosing which session news becomes a notification. */
    onOpenNotifications: () -> Unit = {},
) {
    var confirmUnpair by remember { mutableStateOf(false) }
    val preferences = state.preferences
    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.vettaExtra.pageBackground)
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .padding(bottom = 24.dp),
    ) {
        Box(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            GlassCircleButton(Icons.AutoMirrored.Filled.ArrowBack, stringResource(Res.string.back), onClick = onBack, size = 44.dp, tag = "settings.back")
        }
        Text(
            stringResource(Res.string.settings_title),
            style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp).semantics { heading() },
        )
        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
            Section {
                val desktop = state.desktop
                if (desktop != null) {
                    Row(Modifier.padding(16.dp).testTag("settings.computer"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        Box(
                            Modifier.size(56.dp).clip(RoundedCornerShape(14.dp)).background(MaterialTheme.workColors.pill),
                            contentAlignment = Alignment.Center,
                        ) { Icon(Icons.Filled.Laptop, contentDescription = null, tint = MaterialTheme.workColors.pillInk, modifier = Modifier.size(28.dp)) }
                        Column {
                            Text(desktop.desktopName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 1)
                            Text(linkLine(state), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    if (state.online) {
                        Divider()
                        Value(stringResource(Res.string.latency), state.link.rttMs?.takeIf { it > 0 }?.let { stringResource(Res.string.link_latency, it.toInt()) } ?: "—")
                        Divider()
                        val running = state.link.desktop?.runningSessionCount ?: 0
                        Value(
                            stringResource(Res.string.work_settings_load),
                            if (running > 0) pluralStringResource(Res.plurals.work_settings_load_value, running, running) else stringResource(Res.string.work_settings_load_idle),
                        )
                    }
                    Divider()
                    Action(stringResource(Res.string.work_settings_rescan), "settings.rescan", onClick = onPair)
                } else {
                    Action(stringResource(Res.string.work_settings_scan), "settings.scan", icon = true, onClick = onPair)
                }
            }

            if (onOpenRemote != null) {
                Section {
                    Action(stringResource(Res.string.remote_control), "settings.remote", onClick = onOpenRemote)
                }
            }

            Section {
                Toggle(stringResource(Res.string.work_settings_live_thinking), preferences.liveThinking, "settings.liveThinking") { on ->
                    onPreferences { it.copy(liveThinking = on) }
                }
                Divider()
                Toggle(stringResource(Res.string.work_settings_haptics), preferences.haptics, "settings.haptics") { on ->
                    onPreferences { it.copy(haptics = on) }
                }
            }

            // Notifications need the permission first; turning it on asks for it.
            var denied by remember { mutableStateOf(false) }
            val access =
                rememberNotificationAccess { granted ->
                    denied = !granted
                    if (granted) onBackgroundLink(true)
                }
            Titled(
                null,
                footer = stringResource(if (denied) Res.string.settings_background_link_denied else Res.string.settings_background_link_hint),
            ) {
                Section {
                    Toggle(stringResource(Res.string.settings_background_link), backgroundLink && access.granted, "settings.backgroundLink") { on ->
                        if (on) access.request() else onBackgroundLink(false)
                    }
                    Divider()
                    Action(stringResource(Res.string.notify_settings), "settings.notifications", onClick = onOpenNotifications)
                }
            }

            Titled(stringResource(Res.string.appearance)) {
                Section {
                    listOf(
                        ThemeMode.System to Res.string.theme_system,
                        ThemeMode.Light to Res.string.theme_light,
                        ThemeMode.Dark to Res.string.theme_dark,
                    ).forEachIndexed { index, (mode, label) ->
                        if (index > 0) Divider()
                        Choice(stringResource(label), chosen = themeMode == mode, tag = "settings.theme.${mode.name.lowercase()}") { onThemeMode(mode) }
                    }
                }
            }

            if (state.paired) {
                Titled(null, footer = stringResource(Res.string.work_settings_unpair_hint)) {
                    Section {
                        Action(stringResource(Res.string.work_settings_unpair), "settings.unpair", destructive = true) { confirmUnpair = true }
                    }
                }
            }
            Text(
                stringResource(Res.string.version_number, APP_VERSION),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            )
        }
    }
    if (confirmUnpair) {
        VettaConfirmDialog(
            title = stringResource(Res.string.work_settings_unpair),
            message = stringResource(Res.string.work_settings_unpair_confirm),
            confirmLabel = stringResource(Res.string.work_settings_unpair),
            onConfirm = {
                confirmUnpair = false
                onUnpair()
            },
            onDismiss = { confirmUnpair = false },
        )
    }
}

/** "Securely connected · Cloud relay", or where the link is on its way back. */
@Composable
private fun linkLine(state: MirrorState): String =
    when (val indicator = LinkIndicator.of(state.link)) {
        LinkIndicator.Online -> listOfNotNull(stringResource(Res.string.work_settings_online), linkDetail(state.link.copy(rttMs = null))).joinToString(" · ")
        else -> describe(indicator)
    }
