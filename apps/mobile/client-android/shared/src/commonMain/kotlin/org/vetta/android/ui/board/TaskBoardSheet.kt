package org.vetta.android.ui.board

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.core.nowEpochMs
import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.RemoteSessionSummary
import org.vetta.android.domain.remote.link.LinkIndicator
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.domain.work.TaskBoard
import org.vetta.android.domain.work.WorkOverview
import org.vetta.android.resources.Res
import org.vetta.android.resources.board_empty
import org.vetta.android.resources.board_empty_description
import org.vetta.android.resources.board_section_running
import org.vetta.android.resources.board_section_running_empty
import org.vetta.android.resources.board_section_stopped
import org.vetta.android.resources.board_section_stopped_empty
import org.vetta.android.resources.board_section_waiting
import org.vetta.android.resources.board_section_waiting_empty
import org.vetta.android.resources.board_stale
import org.vetta.android.resources.home_all_sessions
import org.vetta.android.resources.home_task_board
import org.vetta.android.resources.new_session_title
import org.vetta.android.resources.session_delete
import org.vetta.android.resources.session_pin
import org.vetta.android.resources.session_unpin
import org.vetta.android.ui.design.GlassCapsuleButton
import org.vetta.android.ui.design.StatusGlyph
import org.vetta.android.ui.design.VettaSheet
import org.vetta.android.ui.design.hasGlyph
import org.vetta.android.ui.design.springClickable
import org.vetta.android.ui.design.statusLabel
import org.vetta.android.ui.home.ProjectIcon
import org.vetta.android.ui.home.SessionDeleteDialog
import org.vetta.android.ui.i18n.relativeTimeLabel
import org.vetta.android.ui.theme.vettaExtra
import org.vetta.android.ui.work.BotAvatar
import org.vetta.android.ui.work.WorkActions
import org.vetta.android.ui.work.WorkColors
import org.vetta.android.ui.work.workColors
import org.vetta.android.ui.work.workSessionTitle

/**
 * The task board as a sheet over whatever is showing: what is waiting, what is still
 * running, and what stopped within the last day. Opening a session or starting one
 * puts the sheet away. Older sessions are Home's list, reached from the bottom row.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskBoardSheet(
    state: MirrorState,
    actions: WorkActions,
    onOpenSession: (String) -> Unit,
    onNewSession: (projectCwd: String?) -> Unit,
    onShowAllSessions: () -> Unit,
    onRefresh: suspend () -> Unit,
    onDismiss: () -> Unit,
) {
    VettaSheet(onDismiss = onDismiss, title = stringResource(Res.string.home_task_board), expanded = true) {
        TaskBoardView(state, actions, onOpenSession, { onNewSession(null) }, onShowAllSessions, onRefresh)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TaskBoardView(
    state: MirrorState,
    actions: WorkActions,
    onOpenSession: (String) -> Unit,
    onNewSession: () -> Unit,
    onShowAllSessions: () -> Unit,
    onRefresh: suspend () -> Unit,
) {
    val overview = TaskBoard.overview(state.sessions, nowEpochMs())
    var deleting by remember { mutableStateOf<RemoteSessionSummary?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            scope.launch {
                refreshing = true
                try {
                    onRefresh()
                } finally {
                    refreshing = false
                }
            }
        },
        modifier = Modifier.fillMaxWidth().fillMaxHeight(),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .fillMaxHeight()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(horizontal = 16.dp)
                .padding(top = 4.dp, bottom = 28.dp)
                .testTag("board"),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (!state.online && (state.sessionsLoaded || state.sessions.isNotEmpty())) {
                StaleNotice(state.desktop?.lastSeenAt)
            }
            if (overview.clear) {
                if (state.sessionsLoaded || LinkIndicator.of(state.link) == LinkIndicator.Offline) {
                    EmptyBoard(onNewSession, asleep = LinkIndicator.of(state.link) == LinkIndicator.Offline)
                }
            } else {
                OverviewSections(overview, state.conversationCwd, actions, onOpenSession) { deleting = it }
                AllSessions(onShowAllSessions)
            }
        }
    }
    SessionDeleteDialog(deleting, actions) { deleting = null }
}

@Composable
private fun StaleNotice(lastSeenAt: Long?) {
    val colors = MaterialTheme.workColors
    Row(
        Modifier
            .fillMaxWidth()
            .lifted(RoundedCornerShape(16.dp))
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(Icons.Outlined.History, contentDescription = null, tint = colors.ink2, modifier = Modifier.size(16.dp))
        val whenSeen = lastSeenAt?.takeIf { it > 0 }?.let { relativeTimeLabel(it) }
        val label = listOfNotNull(stringResource(Res.string.board_stale), whenSeen).joinToString(" · ")
        Text(label, style = MaterialTheme.typography.bodySmall, color = colors.ink2)
    }
}

@Composable
private fun EmptyBoard(onNewSession: () -> Unit, asleep: Boolean) {
    Column(
        Modifier.fillMaxWidth().padding(top = 72.dp).testTag("board.empty"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        BotAvatar(size = 44.dp, asleep = asleep)
        Text(stringResource(Res.string.board_empty), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        Text(
            stringResource(Res.string.board_empty_description),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 280.dp),
        )
        GlassCapsuleButton(
            stringResource(Res.string.new_session_title),
            onNewSession,
            icon = Icons.Outlined.EditNote,
            height = 48.dp,
            modifier = Modifier.padding(top = 4.dp),
            tag = "board.newSession",
        )
    }
}

@Composable
private fun OverviewSections(
    overview: WorkOverview,
    conversationCwd: String?,
    actions: WorkActions,
    onOpenSession: (String) -> Unit,
    onDelete: (RemoteSessionSummary) -> Unit,
) {
    val colors = MaterialTheme.workColors
    Section(stringResource(Res.string.board_section_waiting), stringResource(Res.string.board_section_waiting_empty), overview.waiting, colors.yellow, "board.section.waiting", conversationCwd, actions, onOpenSession, onDelete)
    Section(stringResource(Res.string.board_section_running), stringResource(Res.string.board_section_running_empty), overview.running, colors.blue, "board.section.running", conversationCwd, actions, onOpenSession, onDelete)
    Section(stringResource(Res.string.board_section_stopped), stringResource(Res.string.board_section_stopped_empty), overview.stopped, colors.ink2, "board.section.stopped", conversationCwd, actions, onOpenSession, onDelete)
}

@Composable
private fun Section(
    title: String,
    empty: String,
    sessions: List<RemoteSessionSummary>,
    accent: Color,
    tag: String,
    conversationCwd: String?,
    actions: WorkActions,
    onOpenSession: (String) -> Unit,
    onDelete: (RemoteSessionSummary) -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().lifted(RoundedCornerShape(22.dp)).testTag(tag),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = if (sessions.isEmpty()) 12.dp else 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(accent))
            Text(
                title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            if (sessions.isNotEmpty()) {
                Text(
                    sessions.size.toString(),
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier =
                        Modifier
                            .clip(CircleShape)
                            .background(accent.copy(alpha = 0.16f))
                            .padding(horizontal = 8.dp, vertical = 2.dp),
                )
            }
        }
        if (sessions.isEmpty()) {
            Text(
                empty,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 30.dp, end = 14.dp, bottom = 14.dp),
            )
        } else {
            OverviewHairline(start = 14.dp)
            sessions.forEachIndexed { index, session ->
                if (index > 0) OverviewHairline()
                key(session.id) {
                    OverviewSession(session, conversationCwd, actions, onOpen = { onOpenSession(session.id) }, onDelete = { onDelete(session) })
                }
            }
        }
    }
}

/** A hairline inset so it starts at the title, not under the status mark. */
@Composable
internal fun OverviewHairline(start: Dp = 60.dp, end: Dp = 14.dp) {
    Box(
        Modifier
            .padding(start = start, end = end)
            .fillMaxWidth()
            .height(1.dp)
            .background(MaterialTheme.vettaExtra.border),
    )
}

/** White (or dark card) lifted off the page grey, with the same hairline the rest of the app uses. */
@Composable
private fun Modifier.lifted(shape: Shape): Modifier =
    this
        .clip(shape)
        .background(MaterialTheme.colorScheme.surface)
        .border(0.75.dp, MaterialTheme.vettaExtra.border, shape)

/** One session on the board, with the same pin and delete menu as Home's list. */
@Composable
private fun OverviewSession(
    session: RemoteSessionSummary,
    conversationCwd: String?,
    actions: WorkActions,
    onOpen: () -> Unit,
    onDelete: () -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    var menu by remember { mutableStateOf(false) }
    Box {
        OverviewRow(
            session,
            conversationCwd,
            onOpen,
            onLongClick = {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                menu = true
            },
        )
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(if (session.pinned) Res.string.session_unpin else Res.string.session_pin)) },
                leadingIcon = { Icon(if (session.pinned) Icons.Outlined.PushPin else Icons.Filled.PushPin, contentDescription = null) },
                onClick = {
                    menu = false
                    actions.setPinned(session.id, !session.pinned)
                },
            )
            DropdownMenuItem(
                text = { Text(stringResource(Res.string.session_delete), color = MaterialTheme.workColors.red) },
                leadingIcon = { Icon(Icons.Filled.Delete, contentDescription = null, tint = MaterialTheme.workColors.red) },
                onClick = {
                    menu = false
                    onDelete()
                },
            )
        }
    }
}

/**
 * A session in the overview: a status mark, the title, the last message, then the
 * project and how long ago it moved. [compact] is the new-session glance, one line
 * of the message. The row itself has no surface; the section around it does.
 */
@Composable
fun OverviewRow(
    session: RemoteSessionSummary,
    conversationCwd: String?,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    onLongClick: (() -> Unit)? = null,
) {
    val colors = MaterialTheme.workColors
    val title = workSessionTitle(session.title)
    val preview = session.preview?.trim()?.takeIf(String::isNotEmpty)
    val project = session.projectName.takeIf { it.isNotBlank() && session.projectCwd != conversationCwd }
    val status = statusLabel(session.status)
    val time = session.updatedAt.takeIf { it > 0 }?.let { relativeTimeLabel(it) }
    val tone = statusTone(session.status, colors)
    Row(
        modifier
            .fillMaxWidth()
            .testTag("session.${session.id}")
            .springClickable(pressedScale = 0.98f, onLongClick = onLongClick, onClick = onOpen)
            .semantics { contentDescription = listOfNotNull(title, status, preview, project, time).joinToString(", ") }
            .padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.padding(top = 1.dp).size(36.dp).clip(CircleShape).background(tone.copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center,
        ) {
            if (session.status.hasGlyph()) {
                StatusGlyph(session.status, size = 16.dp)
            } else {
                Box(Modifier.size(6.dp).clip(CircleShape).background(tone))
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    maxLines = if (compact) 1 else 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (time != null) {
                    Text(time, style = MaterialTheme.typography.labelMedium, color = colors.ink2, maxLines = 1)
                }
            }
            if (preview != null) {
                Text(
                    preview,
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.ink2,
                    maxLines = if (compact) 1 else 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (project != null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(ProjectIcon, contentDescription = null, tint = colors.faint, modifier = Modifier.size(12.dp))
                    Text(project, style = MaterialTheme.typography.labelMedium, color = colors.faint, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

private fun statusTone(status: RemoteSessionStatus, colors: WorkColors): Color =
    when (status) {
        RemoteSessionStatus.WaitingInput -> colors.yellow
        RemoteSessionStatus.Running, RemoteSessionStatus.Thinking -> colors.blue
        RemoteSessionStatus.Error -> colors.red
        else -> colors.ink2
    }

@Composable
private fun AllSessions(onShowAllSessions: () -> Unit) {
    val colors = MaterialTheme.workColors
    val shape = RoundedCornerShape(22.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .lifted(shape)
            .springClickable(highlight = shape, onClick = onShowAllSessions)
            .padding(horizontal = 16.dp, vertical = 14.dp)
            .testTag("board.allSessions"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            stringResource(Res.string.home_all_sessions),
            style = MaterialTheme.typography.titleSmall,
            color = colors.ink2,
            modifier = Modifier.weight(1f),
        )
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = colors.ink2, modifier = Modifier.size(18.dp))
    }
}
