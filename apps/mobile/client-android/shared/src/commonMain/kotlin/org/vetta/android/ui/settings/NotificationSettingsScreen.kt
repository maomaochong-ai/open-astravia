package org.vetta.android.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.RemoteProjectSummary
import org.vetta.android.domain.work.NotificationPrefs
import org.vetta.android.domain.work.QuietHours
import org.vetta.android.resources.Res
import org.vetta.android.resources.back
import org.vetta.android.resources.cancel
import org.vetta.android.resources.confirm
import org.vetta.android.resources.notify_settings
import org.vetta.android.resources.notify_settings_failed
import org.vetta.android.resources.notify_settings_finished
import org.vetta.android.resources.notify_settings_kinds
import org.vetta.android.resources.notify_settings_needs_link
import org.vetta.android.resources.notify_settings_needs_you
import org.vetta.android.resources.notify_settings_projects
import org.vetta.android.resources.notify_settings_projects_hint
import org.vetta.android.resources.notify_settings_quiet
import org.vetta.android.resources.notify_settings_quiet_from
import org.vetta.android.resources.notify_settings_quiet_hint
import org.vetta.android.resources.notify_settings_quiet_on
import org.vetta.android.resources.notify_settings_quiet_to
import org.vetta.android.resources.notify_settings_set_time
import org.vetta.android.ui.design.GlassCircleButton
import org.vetta.android.ui.theme.vettaExtra

/**
 * Which session news becomes a notification: by kind, by project, and quiet hours in which
 * it arrives without sound. Everything is on until turned off.
 */
@Composable
fun NotificationSettingsScreen(
    prefs: NotificationPrefs,
    projects: List<RemoteProjectSummary>,
    backgroundLink: Boolean,
    onChange: ((NotificationPrefs) -> NotificationPrefs) -> Unit,
    onBack: () -> Unit,
) {
    // Which end of the quiet hours is being set, if any.
    var picking by remember { mutableStateOf<QuietEnd?>(null) }
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
            GlassCircleButton(Icons.AutoMirrored.Filled.ArrowBack, stringResource(Res.string.back), onClick = onBack, size = 44.dp, tag = "notifications.back")
        }
        Text(
            stringResource(Res.string.notify_settings),
            style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp).semantics { heading() },
        )
        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
            if (!backgroundLink) {
                Text(
                    stringResource(Res.string.notify_settings_needs_link),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }

            Titled(stringResource(Res.string.notify_settings_kinds)) {
                Section {
                    Toggle(stringResource(Res.string.notify_settings_needs_you), prefs.needsYou, "notifications.needsYou") { on -> onChange { it.copy(needsYou = on) } }
                    Divider()
                    Toggle(stringResource(Res.string.notify_settings_finished), prefs.finished, "notifications.finished") { on -> onChange { it.copy(finished = on) } }
                    Divider()
                    Toggle(stringResource(Res.string.notify_settings_failed), prefs.failed, "notifications.failed") { on -> onChange { it.copy(failed = on) } }
                }
            }

            Titled(stringResource(Res.string.notify_settings_quiet), footer = stringResource(Res.string.notify_settings_quiet_hint)) {
                Section {
                    val quiet = prefs.quietHours
                    Toggle(stringResource(Res.string.notify_settings_quiet_on), quiet != null, "notifications.quiet") { on ->
                        onChange { it.copy(quietHours = if (on) it.quietHours ?: QuietHours() else null) }
                    }
                    if (quiet != null) {
                        Divider()
                        Value(stringResource(Res.string.notify_settings_quiet_from), clock(quiet.startMinute), "notifications.quiet.from") { picking = QuietEnd.Start }
                        Divider()
                        Value(stringResource(Res.string.notify_settings_quiet_to), clock(quiet.endMinute), "notifications.quiet.to") { picking = QuietEnd.End }
                    }
                }
            }

            if (projects.isNotEmpty()) {
                Titled(stringResource(Res.string.notify_settings_projects), footer = stringResource(Res.string.notify_settings_projects_hint)) {
                    Section {
                        projects.forEachIndexed { index, project ->
                            if (index > 0) Divider()
                            Toggle(project.name, project.cwd !in prefs.mutedProjects, "notifications.project.${project.cwd}") { on ->
                                onChange { it.copy(mutedProjects = if (on) it.mutedProjects - project.cwd else it.mutedProjects + project.cwd) }
                            }
                        }
                    }
                }
            }
        }
    }
    val end = picking
    val quiet = prefs.quietHours
    if (end != null && quiet != null) {
        QuietTimeDialog(
            minuteOfDay = if (end == QuietEnd.Start) quiet.startMinute else quiet.endMinute,
            onPick = { minute ->
                onChange { current ->
                    val hours = current.quietHours ?: QuietHours()
                    current.copy(quietHours = if (end == QuietEnd.Start) hours.copy(startMinute = minute) else hours.copy(endMinute = minute))
                }
                picking = null
            },
            onDismiss = { picking = null },
        )
    }
}

private enum class QuietEnd { Start, End }

/** "08:00": minutes after midnight on a 24-hour clock. */
private fun clock(minuteOfDay: Int): String {
    val hour = (minuteOfDay / 60).toString().padStart(2, '0')
    val minute = (minuteOfDay % 60).toString().padStart(2, '0')
    return "$hour:$minute"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun QuietTimeDialog(minuteOfDay: Int, onPick: (Int) -> Unit, onDismiss: () -> Unit) {
    val state = rememberTimePickerState(initialHour = minuteOfDay / 60, initialMinute = minuteOfDay % 60, is24Hour = true)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(Res.string.notify_settings_set_time)) },
        text = { TimePicker(state) },
        confirmButton = { TextButton(onClick = { onPick(state.hour * 60 + state.minute) }) { Text(stringResource(Res.string.confirm)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(Res.string.cancel)) } },
    )
}
