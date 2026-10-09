package org.vetta.android.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.DesktopWindows
import androidx.compose.material.icons.outlined.Laptop
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.sin
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.app.APP_VERSION
import org.vetta.android.app.ThemeMode
import org.vetta.android.domain.remote.link.LinkIndicator
import org.vetta.android.domain.work.MirrorPreferences
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.resources.Res
import org.vetta.android.resources.appearance
import org.vetta.android.resources.back
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
import org.vetta.android.resources.work_settings_rescan
import org.vetta.android.resources.work_settings_scan
import org.vetta.android.resources.work_settings_unpair
import org.vetta.android.resources.work_settings_unpair_confirm
import org.vetta.android.resources.work_unpaired_description
import org.vetta.android.resources.work_unpaired_title
import org.vetta.android.ui.components.VettaConfirmDialog
import org.vetta.android.ui.design.GlassCircleButton
import org.vetta.android.ui.design.VettaMotion
import org.vetta.android.ui.design.springClickable
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

/**
 * The paired computer and how the phone works with it.
 *
 * The computer is one card in the same grouped list as the rest of the page. Its icon
 * sits in the centre, inside a ring that is the link: a green ring that breathes while
 * online, a turning gap while the link is still being made, red when the paired
 * computer is offline, and a still gap once the pairing itself is gone. The name and
 * the route sit under the icon, centred. Remote control and scanning share one band
 * along the bottom of that same card. Phone preferences sit in the next card.
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
            LinkCard(state, onPair, onOpenRemote)

            // Notifications need the permission first; turning it on asks for it.
            var denied by remember { mutableStateOf(false) }
            val access =
                rememberNotificationAccess { granted ->
                    denied = !granted
                    if (granted) onBackgroundLink(true)
                }
            Section {
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
 * The computer, then what can be done with the link.
 *
 * [MirrorState.desktop] stays after an unpairing so earlier sessions keep their name.
 * Only [MirrorState.paired] means the link still exists. A stored computer with
 * [MirrorState.unlinked] set is not "connecting".
 */
@Composable
private fun LinkCard(
    state: MirrorState,
    onPair: () -> Unit,
    onOpenRemote: (() -> Unit)?,
) {
    val desktop = state.desktop
    val linked = state.paired
    val unlinked = state.unlinked != null
    val indicator = LinkIndicator.of(state.link)
    val up = linked && indicator == LinkIndicator.Online
    val colors = MaterialTheme.workColors
    val offline = indicator == LinkIndicator.Offline && linked
    val joining = indicator == LinkIndicator.Connecting || indicator is LinkIndicator.Reconnecting
    val name = desktop?.desktopName?.takeIf { it.isNotBlank() } ?: stringResource(Res.string.settings_link_computer)
    val actions =
        if (linked) {
            buildList {
                if (onOpenRemote != null) {
                    add(CardAction(stringResource(Res.string.remote_control), Icons.Outlined.DesktopWindows, "settings.remote", onOpenRemote))
                }
                add(CardAction(stringResource(Res.string.work_settings_rescan), Icons.Outlined.QrCodeScanner, "settings.rescan", onPair))
            }
        } else {
            listOf(CardAction(stringResource(Res.string.work_settings_scan), Icons.Outlined.QrCodeScanner, "settings.scan", onPair))
        }
    Section {
        custom {
            Column(Modifier.fillMaxWidth()) {
                when {
                    unlinked ->
                        LinkIdentity(
                            title = name,
                            detail = stringResource(Res.string.unlinked_pill),
                            detailColor = colors.ink2,
                            note = stringResource(Res.string.unlinked_description),
                            icon = Icons.Outlined.Laptop,
                            ring = colors.faint,
                            posture = RingPosture.Open,
                            live = false,
                        )
                    linked ->
                        LinkIdentity(
                            title = name,
                            detail = if (up) linkDetail(state.link) else describe(indicator),
                            detailColor = if (offline) colors.red else colors.ink2,
                            note = null,
                            icon = Icons.Outlined.Laptop,
                            ring = when {
                                up -> colors.green
                                offline -> colors.red
                                else -> colors.faint
                            },
                            posture = if (joining) RingPosture.Turning else RingPosture.Closed,
                            live = up,
                        )
                    else ->
                        LinkIdentity(
                            title = stringResource(Res.string.work_unpaired_title),
                            detail = stringResource(Res.string.work_unpaired_description),
                            detailColor = colors.ink2,
                            note = null,
                            icon = Icons.Outlined.QrCodeScanner,
                            ring = colors.faint,
                            posture = RingPosture.Closed,
                            live = false,
                        )
                }
                LinkActionBand(actions)
            }
        }
    }
}

/** One thing the computer card can do. The band lays these out as equal cells. */
private data class CardAction(val label: String, val icon: ImageVector, val tag: String, val onClick: () -> Unit)

/**
 * Actions of this computer, in one band. Two cells split the width and share a
 * vertical rule; a single action takes the whole band. The rule is the same
 * hairline weight as the rest of the form.
 */
@Composable
private fun LinkActionBand(actions: List<CardAction>) {
    val rule = MaterialTheme.vettaExtra.border
    Row(
        Modifier.fillMaxWidth().height(FormMetrics.MinRowHeight).drawBehind {
            val stroke = 0.5.dp.toPx()
            drawLine(rule, Offset(0f, stroke / 2f), Offset(size.width, stroke / 2f), strokeWidth = stroke)
            if (actions.size > 1) {
                val x = size.width / actions.size
                drawLine(rule, Offset(x, 0f), Offset(x, size.height), strokeWidth = stroke)
            }
        },
    ) {
        actions.forEach { action ->
            Row(
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .springClickable(pressedScale = 0.98f, highlight = RectangleShape, onClick = action.onClick)
                    .testTag(action.tag)
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
            ) {
                Icon(action.icon, contentDescription = null, tint = MaterialTheme.workColors.ink2, modifier = Modifier.size(18.dp))
                Text(
                    action.label,
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
            }
        }
    }
}

/** How the ring around the computer reads. A full circle is a settled link; a gap is an open one. */
private enum class RingPosture {
    Closed,
    Open,
    Turning,
}

/**
 * The computer, centred. The ring is the link; the name and the route sit under it.
 */
@Composable
private fun LinkIdentity(
    title: String,
    detail: String?,
    detailColor: Color,
    note: String?,
    icon: ImageVector,
    ring: Color,
    posture: RingPosture,
    live: Boolean,
) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 8.dp, bottom = 18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        PresenceMark(icon, ring, posture, live)
        Column(
            Modifier.fillMaxWidth().padding(top = 4.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                title,
                style = MaterialTheme.typography.titleLarge.copy(fontSize = 20.sp, lineHeight = 26.sp),
                color = MaterialTheme.colorScheme.onSurface,
                textAlign = TextAlign.Center,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (detail != null) {
                Text(
                    detail,
                    style = MaterialTheme.typography.bodyMedium,
                    color = detailColor,
                    textAlign = TextAlign.Center,
                )
            }
            if (note != null) {
                Text(
                    note,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.workColors.ink2,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

/**
 * The computer icon, a status ring, and a quiet disc of the same colour.
 * Online, a second ring expands and fades. While the link is forming, the gap walks
 * around the icon. The ring itself draws on when it appears or changes length.
 */
@Composable
private fun PresenceMark(icon: ImageVector, ring: Color, posture: RingPosture, live: Boolean) {
    val ink by animateColorAsState(ring, VettaMotion.smooth(), label = "link-ring")
    val sweep = remember { Animatable(0f) }
    val targetSweep = if (posture == RingPosture.Closed) 360f else 300f
    LaunchedEffect(targetSweep) {
        sweep.animateTo(targetSweep, VettaMotion.smooth())
    }
    val turn = turningSweep()
    val phase = pulsingPhase()
    val start = if (posture == RingPosture.Turning) turn else -90f
    val stroke = 2.5.dp
    Box(
        Modifier.size(104.dp).drawBehind {
            val diameter = 72.dp.toPx()
            val width = stroke.toPx()
            val left = (size.width - diameter) / 2f + width / 2f
            val arc = diameter - width
            drawCircle(ink.copy(alpha = 0.12f), radius = arc / 2f, center = center)
            if (live) {
                val envelope = sin(phase * PI).toFloat()
                drawCircle(
                    color = ink.copy(alpha = 0.45f * envelope),
                    radius = 36.dp.toPx() + 14.dp.toPx() * phase,
                    center = center,
                    style = Stroke(width = 1.5.dp.toPx()),
                )
            }
            drawArc(
                color = ink,
                startAngle = start,
                sweepAngle = sweep.value,
                useCenter = false,
                topLeft = Offset(left, left),
                size = Size(arc, arc),
                style = Stroke(width = width, cap = if (sweep.value > 359f) StrokeCap.Butt else StrokeCap.Round),
            )
        },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurface, modifier = Modifier.size(28.dp))
    }
}

@Composable
private fun turningSweep(): Float {
    val transition = rememberInfiniteTransition()
    val turn by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(durationMillis = 2400, easing = LinearEasing)),
        label = "link-ring",
    )
    return -90f + turn
}

/** 0 at the start of a breath, 1 at the end. Sine of this fades the halo in and out. */
@Composable
private fun pulsingPhase(): Float {
    val transition = rememberInfiniteTransition()
    val phase by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(durationMillis = 2600, easing = LinearEasing)),
        label = "link-pulse",
    )
    return phase
}

