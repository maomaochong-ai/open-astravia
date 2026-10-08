package org.vetta.android.ui.settings

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Laptop
import androidx.compose.material.icons.outlined.DesktopWindows
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.filled.Smartphone
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
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
import org.vetta.android.resources.remote_control
import org.vetta.android.resources.settings_background_link
import org.vetta.android.resources.settings_background_link_denied
import org.vetta.android.resources.settings_background_link_hint
import org.vetta.android.resources.settings_link_computer
import org.vetta.android.resources.settings_notification_rules
import org.vetta.android.resources.settings_title
import org.vetta.android.resources.theme_dark
import org.vetta.android.resources.theme_light
import org.vetta.android.resources.theme_system
import org.vetta.android.resources.unlinked_description
import org.vetta.android.resources.unlinked_pill
import org.vetta.android.resources.version_number
import org.vetta.android.resources.work_settings_haptics
import org.vetta.android.resources.work_settings_live_thinking
import org.vetta.android.resources.work_settings_load
import org.vetta.android.resources.work_settings_load_idle
import org.vetta.android.resources.work_settings_load_value
import org.vetta.android.resources.work_settings_rescan
import org.vetta.android.resources.work_settings_scan
import org.vetta.android.resources.work_settings_unpair
import org.vetta.android.resources.work_settings_unpair_confirm
import org.vetta.android.resources.work_unpaired_description
import org.vetta.android.ui.components.VettaConfirmDialog
import org.vetta.android.ui.design.GlassCapsuleButton
import org.vetta.android.ui.design.GlassCircleButton
import org.vetta.android.ui.design.form.ButtonRole
import org.vetta.android.ui.design.form.FormMetrics
import org.vetta.android.ui.design.form.Section
import org.vetta.android.ui.design.form.Segment
import org.vetta.android.ui.design.form.button
import org.vetta.android.ui.design.form.custom
import org.vetta.android.ui.design.form.picker
import org.vetta.android.ui.design.form.toggle
import org.vetta.android.ui.theme.vettaExtra
import org.vetta.android.ui.work.describe
import org.vetta.android.ui.work.linkDetail
import org.vetta.android.ui.work.workColors
import kotlin.math.PI
import kotlin.math.sin

/**
 * The paired computer and how the phone works with it.
 *
 * The link is the page's picture: the phone and the computer, and whether data is
 * moving between them. Latency, load, and the switches sit in the open under that
 * picture. The rows below are [Section]s, so titles, separators and the destructive
 * action stay on the same grouped-list metrics.
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
        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(FormMetrics.SectionGap)) {
            LinkCard(state, preferences, onPreferences, onPair, onOpenRemote)

            // Notifications need the permission first; turning it on asks for it.
            var denied by remember { mutableStateOf(false) }
            val access =
                rememberNotificationAccess { granted ->
                    denied = !granted
                    if (granted) onBackgroundLink(true)
                }
            Section {
                toggle(
                    stringResource(Res.string.settings_background_link),
                    backgroundLink && access.granted,
                    onCheckedChange = { on -> if (on) access.request() else onBackgroundLink(false) },
                    supporting = stringResource(if (denied) Res.string.settings_background_link_denied else Res.string.settings_background_link_hint),
                    tag = "settings.backgroundLink",
                )
                button(
                    stringResource(Res.string.settings_notification_rules),
                    onClick = onOpenNotifications,
                    icon = Icons.Outlined.Notifications,
                    role = ButtonRole.Disclosure,
                    tag = "settings.notifications",
                )
            }

            Section(header = stringResource(Res.string.appearance)) {
                picker(
                    listOf(
                        ThemeMode.System to Res.string.theme_system,
                        ThemeMode.Light to Res.string.theme_light,
                        ThemeMode.Dark to Res.string.theme_dark,
                    ).map { (mode, label) ->
                        Segment(
                            label = stringResource(label),
                            selected = themeMode == mode,
                            tag = "settings.theme.${mode.name.lowercase()}",
                            onSelect = { onThemeMode(mode) },
                        )
                    },
                )
            }

            if (state.paired) {
                Section {
                    button(
                        stringResource(Res.string.work_settings_unpair),
                        onClick = { confirmUnpair = true },
                        role = ButtonRole.Destructive,
                        tag = "settings.unpair",
                    )
                }
            }
            Text(
                stringResource(Res.string.version_number, APP_VERSION),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
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

/**
 * Phone and computer as one picture. Details stay open. While the link is up, one dot
 * drifts from the computer to the phone; that motion is the connected mark.
 *
 * [MirrorState.desktop] stays after an unpairing so earlier sessions keep their name.
 * Only [MirrorState.paired] means the link still exists. A stored computer with
 * [MirrorState.unlinked] set is not "connecting".
 */
@Composable
private fun LinkCard(
    state: MirrorState,
    preferences: MirrorPreferences,
    onPreferences: ((MirrorPreferences) -> MirrorPreferences) -> Unit,
    onPair: () -> Unit,
    onOpenRemote: (() -> Unit)?,
) {
    val desktop = state.desktop
    val linked = state.paired
    val unlinked = state.unlinked != null
    val indicator = LinkIndicator.of(state.link)
    val up = linked && indicator == LinkIndicator.Online
    val statusColor =
        if (indicator == LinkIndicator.Offline && linked) {
            MaterialTheme.workColors.red
        } else {
            MaterialTheme.workColors.ink2
        }
    val computerName =
        desktop?.desktopName?.takeIf { linked || unlinked } ?: stringResource(Res.string.settings_link_computer)
    Section {
        custom {
            Column(
                Modifier.fillMaxWidth().padding(bottom = if (linked) 8.dp else 0.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 20.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Box(Modifier.weight(1f), contentAlignment = Alignment.TopCenter) {
                        DeviceNode(
                            icon = Icons.Filled.Laptop,
                            name = computerName,
                            // A remembered computer stays readable. Only a computer we never
                            // paired is the faint placeholder.
                            present = linked || unlinked,
                        )
                    }
                    // The bridge sits on the icon, not on the name underneath it.
                    LinkBridge(up = up, modifier = Modifier.padding(top = 10.dp))
                    Box(Modifier.weight(1f), contentAlignment = Alignment.TopCenter) {
                        DeviceNode(
                            icon = Icons.Filled.Smartphone,
                            name = phoneModel(),
                            present = true,
                        )
                    }
                }
                when {
                    unlinked -> UnlinkedNotice(onPair)
                    !linked -> UnpairedNotice(onPair)
                    !up ->
                        Text(
                            describe(indicator),
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium,
                            color = statusColor,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(top = 14.dp, bottom = 8.dp),
                        )
                }
            }
        }
        if (linked) {
            if (state.online) {
                custom {
                    val running = state.link.desktop?.runningSessionCount ?: 0
                    val latency = state.link.rttMs?.takeIf { it > 0 }?.let { stringResource(Res.string.link_latency, it.toInt()) } ?: "—"
                    val load = if (running > 0) pluralStringResource(Res.plurals.work_settings_load_value, running, running) else stringResource(Res.string.work_settings_load_idle)
                    linkDetail(state.link.copy(rttMs = null))?.let { channel ->
                        Text(
                            channel,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.workColors.ink2,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 14.dp),
                        )
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Fact(stringResource(Res.string.latency), latency, Modifier.weight(1f))
                        Box(Modifier.width(0.5.dp).height(36.dp).background(MaterialTheme.vettaExtra.border))
                        Fact(stringResource(Res.string.work_settings_load), load, Modifier.weight(1f))
                    }
                }
            }
            if (onOpenRemote != null) {
                button(
                    stringResource(Res.string.remote_control),
                    onClick = onOpenRemote,
                    icon = Icons.Outlined.DesktopWindows,
                    role = ButtonRole.Disclosure,
                    tag = "settings.remote",
                )
            }
            button(
                stringResource(Res.string.work_settings_rescan),
                onClick = onPair,
                icon = Icons.Outlined.QrCodeScanner,
                tag = "settings.rescan",
            )
            toggle(
                stringResource(Res.string.work_settings_live_thinking),
                preferences.liveThinking,
                onCheckedChange = { on -> onPreferences { it.copy(liveThinking = on) } },
                tag = "settings.liveThinking",
            )
            toggle(
                stringResource(Res.string.work_settings_haptics),
                preferences.haptics,
                onCheckedChange = { on -> onPreferences { it.copy(haptics = on) } },
                tag = "settings.haptics",
            )
        }
    }
}

/** Never paired: how to connect, and the scan button. */
@Composable
private fun UnpairedNotice(onPair: () -> Unit) {
    Text(
        stringResource(Res.string.work_unpaired_description),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(top = 12.dp, bottom = 4.dp),
    )
    ScanToConnect(onPair)
}

/**
 * Unpaired, with the computer still remembered. The line stays dashed.
 * The words say the pairing is over, not that it is starting.
 */
@Composable
private fun UnlinkedNotice(onPair: () -> Unit) {
    Text(
        stringResource(Res.string.unlinked_pill),
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = FontWeight.Medium,
        color = MaterialTheme.colorScheme.onSurface,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(top = 14.dp),
    )
    Text(
        stringResource(Res.string.unlinked_description),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(top = 6.dp, bottom = 4.dp),
    )
    ScanToConnect(onPair)
}

@Composable
private fun ScanToConnect(onPair: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 18.dp, top = 4.dp),
        contentAlignment = Alignment.Center,
    ) {
        GlassCapsuleButton(
            text = stringResource(Res.string.work_settings_scan),
            onClick = onPair,
            icon = Icons.Outlined.QrCodeScanner,
            height = 44.dp,
            tag = "settings.scan",
        )
    }
}

@Composable
private fun DeviceNode(icon: ImageVector, name: String, present: Boolean) {
    val ink = if (present) MaterialTheme.colorScheme.onSurface else MaterialTheme.workColors.faint
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
    ) {
        Icon(icon, contentDescription = null, tint = ink, modifier = Modifier.size(44.dp))
        Text(
            name,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Medium,
            color = ink,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * The line between the two devices. Solid while the link is up, with one ink dot
 * drifting from the computer toward the phone. Dashed otherwise. No second color.
 */
@Composable
private fun LinkBridge(up: Boolean, modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition(label = "link flow")
    val travel by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(durationMillis = 3200, easing = LinearEasing), RepeatMode.Restart),
        label = "link packet",
    )
    val ink = MaterialTheme.colorScheme.onSurface
    val line = if (up) ink.copy(alpha = 0.55f) else MaterialTheme.vettaExtra.border
    Canvas(modifier.width(96.dp).height(24.dp)) {
        val y = size.height / 2f
        drawLine(
            line,
            Offset(0f, y),
            Offset(size.width, y),
            strokeWidth = 1.dp.toPx(),
            cap = StrokeCap.Round,
            pathEffect = if (up) null else PathEffect.dashPathEffect(floatArrayOf(2.5.dp.toPx(), 4.dp.toPx())),
        )
        if (up) {
            val presence = sin(travel * PI).toFloat().coerceIn(0f, 1f)
            drawCircle(ink.copy(alpha = presence), radius = 2.5.dp.toPx(), center = Offset(size.width * travel, y))
        }
    }
}

@Composable
private fun Fact(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier.padding(horizontal = 12.dp, vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        Text(value, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 2, textAlign = TextAlign.Center)
    }
}

