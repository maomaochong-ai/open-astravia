package org.vetta.android.ui.work

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Laptop
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.pluralStringResource
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.link.LinkIndicator
import org.vetta.android.domain.work.ConfirmPolicy
import org.vetta.android.domain.work.MirrorPreferences
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.resources.Res
import org.vetta.android.resources.back
import org.vetta.android.resources.latency
import org.vetta.android.resources.link_latency
import org.vetta.android.resources.work_settings_confirm_policy
import org.vetta.android.resources.work_settings_confirm_policy_hint
import org.vetta.android.resources.work_settings_haptics
import org.vetta.android.resources.work_settings_live_thinking
import org.vetta.android.resources.work_settings_load
import org.vetta.android.resources.work_settings_load_idle
import org.vetta.android.resources.work_settings_load_value
import org.vetta.android.resources.work_settings_online
import org.vetta.android.resources.work_settings_policy_auto
import org.vetta.android.resources.work_settings_policy_important
import org.vetta.android.resources.work_settings_policy_major
import org.vetta.android.resources.work_settings_title
import org.vetta.android.resources.work_settings_unpair
import org.vetta.android.resources.work_settings_unpair_confirm
import org.vetta.android.resources.work_settings_unpair_hint
import org.vetta.android.ui.components.VettaConfirmDialog
import org.vetta.android.ui.theme.vettaExtra

/**
 * The paired computer and how the phone works with it, grouped like system
 * settings: the computer and its link, when to confirm on the phone, what the
 * chat shows, and unpairing. `pairing` is the scan button (to pair, or pair again).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkSettingsScreen(
    state: MirrorState,
    onPreferences: ((MirrorPreferences) -> MirrorPreferences) -> Unit,
    onUnpair: () -> Unit,
    onBack: () -> Unit,
    pairing: @Composable () -> Unit,
) {
    var confirmUnpair by remember { mutableStateOf(false) }
    val preferences = state.preferences
    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(Res.string.work_settings_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.back)) }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.vettaExtra.pageBackground),
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Group {
                val desktop = state.desktop
                if (desktop != null) {
                    Row(Modifier.padding(16.dp).testTag("settings.computer"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        Box(
                            Modifier.size(56.dp).clip(RoundedCornerShape(14.dp)).background(MaterialTheme.workColors.pill),
                            contentAlignment = Alignment.Center,
                        ) { Icon(Icons.Filled.Laptop, contentDescription = null, tint = MaterialTheme.workColors.pillInk, modifier = Modifier.size(28.dp)) }
                        Column {
                            Text(desktop.desktopName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 1)
                            Text(linkLine(state), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.vettaExtra.secondaryText)
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
                }
                Box(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)) { pairing() }
            }

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Group {
                    Text(
                        stringResource(Res.string.work_settings_confirm_policy),
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.padding(start = 16.dp, top = 14.dp, bottom = 4.dp),
                    )
                    listOf(
                        ConfirmPolicy.Major to Res.string.work_settings_policy_major,
                        ConfirmPolicy.Important to Res.string.work_settings_policy_important,
                        ConfirmPolicy.Auto to Res.string.work_settings_policy_auto,
                    ).forEach { (policy, label) ->
                        val chosen = preferences.confirmPolicy == policy
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable { onPreferences { it.copy(confirmPolicy = policy) } }
                                .semantics {
                                    role = Role.RadioButton
                                    selected = chosen
                                }.padding(horizontal = 16.dp, vertical = 12.dp)
                                .testTag("settings.policy.${policy.name.lowercase()}"),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(stringResource(label), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                            if (chosen) Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                        }
                    }
                }
                Footnote(stringResource(Res.string.work_settings_confirm_policy_hint))
            }

            Group {
                Toggle(stringResource(Res.string.work_settings_live_thinking), preferences.liveThinking, "settings.liveThinking") { on ->
                    onPreferences { it.copy(liveThinking = on) }
                }
                Divider()
                Toggle(stringResource(Res.string.work_settings_haptics), preferences.haptics, "settings.haptics") { on ->
                    onPreferences { it.copy(haptics = on) }
                }
            }

            if (state.paired) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Group {
                        TextButton(onClick = { confirmUnpair = true }, modifier = Modifier.fillMaxWidth().testTag("settings.unpair")) {
                            Text(stringResource(Res.string.work_settings_unpair), color = MaterialTheme.workColors.red)
                        }
                    }
                    Footnote(stringResource(Res.string.work_settings_unpair_hint))
                }
            }
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

@Composable
private fun Group(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surface)) { content() }
}

@Composable
private fun Divider() {
    HorizontalDivider(Modifier.padding(start = 16.dp), color = MaterialTheme.vettaExtra.border)
}

@Composable
private fun Value(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp)) {
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.vettaExtra.secondaryText)
    }
}

@Composable
private fun Toggle(label: String, on: Boolean, tag: String, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable { onChange(!on) }.padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Switch(checked = on, onCheckedChange = onChange, modifier = Modifier.testTag(tag))
    }
}

@Composable
private fun Footnote(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText, modifier = Modifier.padding(horizontal = 16.dp))
}
