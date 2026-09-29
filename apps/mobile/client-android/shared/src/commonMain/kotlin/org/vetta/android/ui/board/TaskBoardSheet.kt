package org.vetta.android.ui.board

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.VisibilityThreshold
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.pluralStringResource
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.RemoteSessionSummary
import org.vetta.android.domain.remote.link.LinkIndicator
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.domain.work.TaskBoard
import org.vetta.android.domain.work.TaskBoardCard
import org.vetta.android.resources.Res
import org.vetta.android.resources.board_empty
import org.vetta.android.resources.board_empty_description
import org.vetta.android.resources.board_more
import org.vetta.android.resources.board_stale
import org.vetta.android.resources.home_all_sessions
import org.vetta.android.resources.home_task_board
import org.vetta.android.resources.new_session_title
import org.vetta.android.resources.session_delete
import org.vetta.android.resources.session_pin
import org.vetta.android.resources.session_unpin
import org.vetta.android.resources.work_conversation
import org.vetta.android.ui.design.GlassCapsuleButton
import org.vetta.android.ui.design.StatusGlyph
import org.vetta.android.ui.design.VettaMotion
import org.vetta.android.ui.design.VettaSheet
import org.vetta.android.ui.design.hasGlyph
import org.vetta.android.ui.design.springClickable
import org.vetta.android.ui.design.springContentSize
import org.vetta.android.ui.design.statusLabel
import org.vetta.android.ui.home.ProjectIcon
import org.vetta.android.ui.home.ProjectScreen
import org.vetta.android.ui.home.SessionDeleteDialog
import org.vetta.android.ui.work.BotAvatar
import org.vetta.android.ui.work.WorkActions
import org.vetta.android.ui.work.workColors
import org.vetta.android.ui.work.workSessionTitle

/**
 * The task board as a sheet over whatever is showing (the iPhone's `TaskBoardSheet`),
 * with its own stack for a project's page. Opening a session or starting one puts the
 * sheet away.
 */
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
    var project by remember { mutableStateOf<String?>(null) }
    VettaSheet(onDismiss = onDismiss, title = if (project == null) stringResource(Res.string.home_task_board) else null, expanded = true) {
        AnimatedContent(
            project,
            transitionSpec = {
                val spring = VettaMotion.snappy(IntOffset.VisibilityThreshold)
                if (targetState != null) {
                    (slideInHorizontally(spring) { it } + fadeIn()) togetherWith (slideOutHorizontally(spring) { -it / 4 } + fadeOut())
                } else {
                    (slideInHorizontally(spring) { -it / 4 } + fadeIn()) togetherWith (slideOutHorizontally(spring) { it } + fadeOut())
                }
            },
            label = "board stack",
        ) { cwd ->
            if (cwd == null) {
                TaskBoardView(state, actions, onOpenSession, { onNewSession(null) }, onShowAllSessions) { project = it }
            } else {
                ProjectScreen(
                    cwd = cwd,
                    state = state,
                    actions = actions,
                    onBack = { project = null },
                    onOpenSession = onOpenSession,
                    onNewSession = { onNewSession(cwd) },
                    onRefresh = onRefresh,
                    edgeToEdge = false,
                )
            }
        }
    }
}

/**
 * Every project with work under way, and the most recent ones, as a two-column waterfall
 * of cards ranked by [TaskBoard]: what waits on the user first, then what runs, then the rest.
 */
@Composable
private fun TaskBoardView(
    state: MirrorState,
    actions: WorkActions,
    onOpenSession: (String) -> Unit,
    onNewSession: () -> Unit,
    onShowAllSessions: () -> Unit,
    onOpenProject: (String) -> Unit,
) {
    val cards = remember(state.sessions, state.conversationCwd) { TaskBoard.cards(state.sessions, state.conversationCwd) }
    var deleting by remember { mutableStateOf<RemoteSessionSummary?>(null) }
    Column(
        Modifier
            .fillMaxWidth()
            .fillMaxHeight()
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .padding(horizontal = 16.dp)
            .padding(bottom = 24.dp)
            .testTag("board"),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Before the first answer the cards may be out of date.
        if (!state.online && cards.isNotEmpty()) {
            Row(Modifier.padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Outlined.History, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
                Text(stringResource(Res.string.board_stale), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TaskBoard.columns(cards, 2).forEach { column ->
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    column.forEach { card ->
                        key(card.cwd) {
                            BoardCard(card, actions, onOpenSession, onOpenProject, onDelete = { deleting = it })
                        }
                    }
                }
            }
        }
        if (cards.isEmpty()) {
            if (state.sessionsLoaded || LinkIndicator.of(state.link) == LinkIndicator.Offline) {
                Column(Modifier.fillMaxWidth().padding(top = 72.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    BotAvatar(size = 44.dp, asleep = LinkIndicator.of(state.link) == LinkIndicator.Offline)
                    Text(stringResource(Res.string.board_empty), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    Text(
                        stringResource(Res.string.board_empty_description),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                    GlassCapsuleButton(stringResource(Res.string.new_session_title), onNewSession, icon = Icons.Outlined.EditNote, height = 48.dp, modifier = Modifier.padding(top = 4.dp), tag = "board.newSession")
                }
            }
        } else {
            // Older projects are left to Home's list, which filters by project.
            Row(
                Modifier
                    .fillMaxWidth()
                    .springClickable(onClick = onShowAllSessions)
                    .padding(vertical = 12.dp)
                    .testTag("board.allSessions"),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(stringResource(Res.string.home_all_sessions), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
            }
        }
    }
    SessionDeleteDialog(deleting, actions) { deleting = null }
}

/**
 * One project, or the conversations, on the board: its name, then its sessions, each
 * opening its chat; a project's name opens its page. The card grows and shrinks with
 * its sessions rather than jumping.
 */
@Composable
private fun BoardCard(
    card: TaskBoardCard,
    actions: WorkActions,
    onOpenSession: (String) -> Unit,
    onOpenProject: (String) -> Unit,
    onDelete: (RemoteSessionSummary) -> Unit,
) {
    val colors = MaterialTheme.workColors
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(colors.card2)
            .padding(12.dp)
            .springContentSize()
            .testTag("board.card.${card.name}"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        val name = if (card.isConversation) stringResource(Res.string.work_conversation) else card.name
        Row(
            Modifier
                .fillMaxWidth()
                .then(if (card.isConversation) Modifier else Modifier.springClickable { onOpenProject(card.cwd) })
                .semantics { heading() }
                .padding(start = 4.dp, end = 4.dp, bottom = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Icon(if (card.isConversation) Icons.Outlined.ChatBubbleOutline else ProjectIcon, contentDescription = null, modifier = Modifier.size(14.dp))
            Text(name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            // The conversations have no page of their own.
            if (!card.isConversation) Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = colors.faint, modifier = Modifier.size(16.dp))
        }
        card.sessions.forEach { session ->
            key(session.id) { BoardRow(session, actions, onOpen = { onOpenSession(session.id) }, onDelete = { onDelete(session) }) }
        }
        if (card.hidden > 0) {
            Text(
                pluralStringResource(Res.plurals.board_more, card.hidden, card.hidden),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier =
                    Modifier
                        .padding(horizontal = 4.dp)
                        .then(if (card.isConversation) Modifier else Modifier.springClickable { onOpenProject(card.cwd) }),
            )
        }
    }
}

@Composable
private fun BoardRow(session: RemoteSessionSummary, actions: WorkActions, onOpen: () -> Unit, onDelete: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    var menu by remember { mutableStateOf(false) }
    val title = workSessionTitle(session.title)
    val label = listOfNotNull(title, statusLabel(session.status)).joinToString(", ")
    Box {
        BoardSessionChip(
            session,
            lineLimit = 2,
            modifier =
                Modifier
                    .testTag("session.${session.id}")
                    .springClickable(
                        pressedScale = 0.96f,
                        highlight = RoundedCornerShape(12.dp),
                        onLongClick = {
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            menu = true
                        },
                        onClick = onOpen,
                    ).semantics { contentDescription = label },
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
 * A session on a board card, on its own strip: status, then the title. Waiting sessions
 * are warmed, as in Home's list. Only the look; callers make it tappable.
 */
@Composable
fun BoardSessionChip(session: RemoteSessionSummary, lineLimit: Int, modifier: Modifier = Modifier) {
    val colors = MaterialTheme.workColors
    val warmth by animateColorAsState(
        if (session.status == RemoteSessionStatus.WaitingInput) colors.yellow.copy(alpha = 0.12f) else colors.yellow.copy(alpha = 0f),
        VettaMotion.snappy(),
        label = "chip warmth",
    )
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surface)
            .background(warmth)
            .padding(horizontal = 8.dp, vertical = 7.dp),
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box(Modifier.width(14.dp).padding(top = 3.dp), contentAlignment = Alignment.Center) {
            if (session.status.hasGlyph()) {
                StatusGlyph(session.status, size = 13.dp)
            } else {
                Box(Modifier.size(5.dp).clip(CircleShape).background(colors.faint))
            }
        }
        Text(
            workSessionTitle(session.title),
            style = MaterialTheme.typography.bodyMedium,
            maxLines = lineLimit,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
}
