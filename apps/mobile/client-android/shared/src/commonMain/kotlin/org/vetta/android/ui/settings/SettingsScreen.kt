package org.vetta.android.ui.settings

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.DesktopWindows
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.QrCodeScanner
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
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.drawscope.Stroke
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
import org.vetta.android.resources.link_live
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
 * The computer is one card in the same grouped list as the rest of the page. A line
 * drawing of the computer sits in the centre, with its name and the link under it.
 * Remote control and scanning are separate buttons beneath that. Phone preferences
 * sit in the next card.
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
    val fallbackName = stringResource(Res.string.settings_link_computer)
    val name = desktop?.desktopName?.takeIf { it.isNotBlank() } ?: fallbackName
    // Resolved on every frame so a link change does not reshuffle composition.
    val live = stringResource(Res.string.link_live)
    val words = describe(indicator)
    val route = linkDetail(state.link)
    val unpairedTitle = stringResource(Res.string.work_unpaired_title)
    val unpairedBody = stringResource(Res.string.work_unpaired_description)
    val unlinkedPill = stringResource(Res.string.unlinked_pill)
    val unlinkedBody = stringResource(Res.string.unlinked_description)
    val remoteLabel = stringResource(Res.string.remote_control)
    val rescanLabel = stringResource(Res.string.work_settings_rescan)
    val scanLabel = stringResource(Res.string.work_settings_scan)
    val actions =
        if (linked) {
            buildList {
                if (onOpenRemote != null) {
                    add(CardAction(remoteLabel, Icons.Outlined.DesktopWindows, "settings.remote", onOpenRemote))
                }
                add(CardAction(rescanLabel, Icons.Outlined.QrCodeScanner, "settings.rescan", onPair))
            }
        } else {
            listOf(CardAction(scanLabel, Icons.Outlined.QrCodeScanner, "settings.scan", onPair))
        }
    val header =
        when {
            unlinked ->
                DeviceCopy(
                    title = name,
                    status = unlinkedPill,
                    statusColor = colors.ink2,
                    detail = null,
                    note = unlinkedBody,
                    showComputer = true,
                    breathing = false,
                )
            up ->
                DeviceCopy(
                    title = name,
                    status = live,
                    statusColor = colors.green,
                    detail = route,
                    note = null,
                    showComputer = true,
                    breathing = false,
                )
            linked && joining ->
                DeviceCopy(
                    title = name,
                    status = words,
                    statusColor = colors.ink2,
                    detail = null,
                    note = null,
                    showComputer = true,
                    breathing = true,
                )
            linked ->
                DeviceCopy(
                    title = name,
                    status = words,
                    statusColor = if (offline) colors.red else colors.ink2,
                    detail = null,
                    note = null,
                    showComputer = true,
                    breathing = false,
                )
            else ->
                DeviceCopy(
                    title = unpairedTitle,
                    status = null,
                    statusColor = colors.ink2,
                    detail = unpairedBody,
                    note = null,
                    showComputer = false,
                    breathing = false,
                )
        }
    Section {
        custom {
            Column(Modifier.fillMaxWidth()) {
                DeviceHeader(header)
                ActionWell(actions)
            }
        }
    }
}

/** What the centred header says. [detail] stays its own line of text, apart from [status]. */
private data class DeviceCopy(
    val title: String,
    val status: String?,
    val statusColor: Color,
    val detail: String?,
    val note: String?,
    val showComputer: Boolean,
    val breathing: Boolean,
)

/** One thing the computer card can do. Each action is its own button, with an icon. */
private data class CardAction(val label: String, val icon: ImageVector, val tag: String, val onClick: () -> Unit)

/**
 * The computer, centred, then its name and the link. [DeviceCopy.detail] is a separate
 * text node from the status word, so the route stays exactly the string the home pill uses.
 */
@Composable
private fun DeviceHeader(copy: DeviceCopy) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = if (copy.showComputer) 28.dp else 22.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (copy.showComputer) ComputerMark(copy.breathing)
        Text(
            copy.title,
            style = MaterialTheme.typography.titleLarge.copy(fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold),
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = if (copy.showComputer) 16.dp else 0.dp),
        )
        if (copy.status != null || copy.detail != null) {
            LinkSentence(copy)
        }
        if (copy.note != null) {
            Text(
                copy.note,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.workColors.ink2,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
    }
}

/**
 * Status and route on one centred line. The route is its own text, with the dot beside
 * it, so a reader of the route does not also receive the status word.
 */
@Composable
private fun LinkSentence(copy: DeviceCopy) {
    val ink2 = MaterialTheme.workColors.ink2
    if (copy.status != null && copy.detail == null) {
        Text(
            copy.status,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
            color = copy.statusColor,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 6.dp),
        )
        return
    }
    if (copy.status == null && copy.detail != null) {
        Text(
            copy.detail,
            style = MaterialTheme.typography.bodyMedium,
            color = ink2,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 6.dp),
        )
        return
    }
    Row(
        Modifier.fillMaxWidth().padding(top = 6.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            copy.status.orEmpty(),
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
            color = copy.statusColor,
            maxLines = 1,
            softWrap = false,
        )
        Text(" · ", style = MaterialTheme.typography.bodyMedium, color = ink2, maxLines = 1, softWrap = false)
        Text(
            copy.detail.orEmpty(),
            style = MaterialTheme.typography.bodyMedium,
            color = ink2,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
    }
}

/**
 * A line drawing of the computer. The screen is filled so the deck behind it stays hidden,
 * and that fill breathes only while the link is still being made.
 */
@Composable
private fun ComputerMark(breathing: Boolean) {
    val ink = MaterialTheme.colorScheme.onSurface
    val card = MaterialTheme.colorScheme.surface
    val phase = screenPhase()
    val wave = ((sin(phase * PI) + 1.0) / 2.0).toFloat()
    val glass = if (breathing) 0.05f + 0.14f * wave else 0.07f
    Canvas(Modifier.size(width = 148.dp, height = 96.dp)) {
        val stroke = 1.6.dp.toPx()
        val screenW = 88.dp.toPx()
        val screenH = 54.dp.toPx()
        val screenLeft = (size.width - screenW) / 2f
        val screenTop = 8.dp.toPx()
        val screenCorner = CornerRadius(6.dp.toPx())
        val inset = 5.dp.toPx()
        val deckW = 116.dp.toPx()
        val deckH = 13.dp.toPx()
        val deckLeft = (size.width - deckW) / 2f
        val deckTop = screenTop + screenH - stroke
        drawRoundRect(
            color = ink,
            topLeft = Offset(deckLeft, deckTop),
            size = Size(deckW, deckH),
            cornerRadius = CornerRadius(6.5.dp.toPx()),
            style = Stroke(width = stroke),
        )
        drawRoundRect(
            color = card,
            topLeft = Offset(screenLeft, screenTop),
            size = Size(screenW, screenH),
            cornerRadius = screenCorner,
        )
        drawRoundRect(
            color = ink.copy(alpha = glass),
            topLeft = Offset(screenLeft + inset, screenTop + inset),
            size = Size(screenW - inset * 2, screenH - inset * 2),
            cornerRadius = CornerRadius(3.dp.toPx()),
        )
        drawRoundRect(
            color = ink,
            topLeft = Offset(screenLeft, screenTop),
            size = Size(screenW, screenH),
            cornerRadius = screenCorner,
            style = Stroke(width = stroke),
        )
    }
}

/** One breath, from dim to bright and back. Kept running so the drawing does not restart. */
@Composable
private fun screenPhase(): Float {
    val transition = rememberInfiniteTransition()
    val phase by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(durationMillis = 2200, easing = LinearEasing)),
        label = "screen-breath",
    )
    return phase
}

/**
 * Remote control and scanning as separate buttons. A shared track would read as a
 * slider, so each action keeps its own fill and a gap of the card shows between them.
 * One action still uses the full row.
 */
@Composable
private fun ActionWell(actions: List<CardAction>) {
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .padding(top = 18.dp, bottom = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        actions.forEach { action ->
            Box(
                Modifier
                    .weight(1f)
                    .height(44.dp)
                    .springClickable(pressedScale = 0.98f, highlight = shape, onClick = action.onClick)
                    .testTag(action.tag)
                    .clip(shape)
                    .background(MaterialTheme.workColors.card2),
                contentAlignment = Alignment.Center,
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
                ) {
                    Icon(
                        action.icon,
                        contentDescription = null,
                        tint = MaterialTheme.workColors.ink2,
                        modifier = Modifier.size(18.dp),
                    )
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
}

