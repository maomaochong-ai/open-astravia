package org.vetta.android.ui.home

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import org.vetta.android.ui.theme.vettaExtra
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.QuestionMark
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.pluralStringResource
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.RemoteSessionSummary
import org.vetta.android.domain.work.ProjectDigest
import org.vetta.android.domain.work.ProjectScope
import org.vetta.android.domain.work.SessionFilter
import org.vetta.android.domain.work.SessionStatusGroup
import org.vetta.android.resources.Res
import org.vetta.android.resources.home_filter_status
import org.vetta.android.resources.home_pick_project
import org.vetta.android.resources.home_session_count
import org.vetta.android.resources.home_tasks
import org.vetta.android.resources.home_updated
import org.vetta.android.resources.new_session_title
import org.vetta.android.resources.session_delete
import org.vetta.android.resources.session_delete_message
import org.vetta.android.resources.session_delete_title
import org.vetta.android.resources.session_pin
import org.vetta.android.resources.session_pinned
import org.vetta.android.resources.session_unpin
import org.vetta.android.resources.work_group_done
import org.vetta.android.resources.work_group_processing
import org.vetta.android.resources.work_group_waiting
import org.vetta.android.resources.work_status_all
import org.vetta.android.ui.components.VettaConfirmDialog
import org.vetta.android.ui.design.GlassCapsuleButton
import org.vetta.android.ui.design.StatusGlyph
import org.vetta.android.ui.design.VettaMotion
import org.vetta.android.ui.design.springClickable
import org.vetta.android.ui.design.statusLabel
import org.vetta.android.ui.i18n.relativeTimeLabel
import org.vetta.android.ui.work.WorkActions
import org.vetta.android.ui.work.workColors
import org.vetta.android.ui.work.workSessionTitle

/** The project icon, on project rows and session badges. */
val ProjectIcon: ImageVector = Icons.Outlined.Folder

/**
 * A session as Home and a project's page list it, on one line (the iPhone's
 * `SessionCard`): a pin, the title, then at the far right its project as a badge and a
 * status glyph while it needs a look. Conversations name no project, and a project's own
 * page leaves it out. A tap opens it; a long press offers pin and delete.
 */
@Composable
fun SessionCard(
    session: RemoteSessionSummary,
    conversationCwd: String?,
    actions: WorkActions,
    onOpen: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
    showsProject: Boolean = true,
) {
    val colors = MaterialTheme.workColors
    val haptics = LocalHapticFeedback.current
    var menu by remember { mutableStateOf(false) }
    val title = workSessionTitle(session.title)
    val project = session.projectName.takeIf { showsProject && session.projectCwd != conversationCwd }
    val status = statusLabel(session.status)
    val pinnedLabel = stringResource(Res.string.session_pinned)
    val pinLabel = stringResource(if (session.pinned) Res.string.session_unpin else Res.string.session_pin)
    val deleteLabel = stringResource(Res.string.session_delete)
    // Waiting on the user warms the whole row, not just its glyph.
    val background by animateColorAsState(
        if (session.status == RemoteSessionStatus.WaitingInput) colors.yellow.copy(alpha = 0.09f) else colors.yellow.copy(alpha = 0f),
        VettaMotion.snappy(),
        label = "row warmth",
    )
    Box(modifier) {
        Row(
            Modifier
                .fillMaxWidth()
                // Before the semantics below, which would otherwise clear it.
                .testTag("session.${session.id}")
                .background(background)
                .springClickable(
                    pressedScale = 0.98f,
                    highlight = RectangleShape,
                    onLongClick = {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        menu = true
                    },
                    onClick = onOpen,
                ).clearAndSetSemantics {
                    contentDescription = listOfNotNull(title, status, pinnedLabel.takeIf { session.pinned }, project).joinToString(", ")
                    customActions =
                        listOf(
                            CustomAccessibilityAction(pinLabel) {
                                actions.setPinned(session.id, !session.pinned)
                                true
                            },
                            CustomAccessibilityAction(deleteLabel) {
                                onDelete()
                                true
                            },
                        )
                }.padding(horizontal = 20.dp, vertical = 13.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (session.pinned) Icon(Icons.Filled.PushPin, contentDescription = null, tint = colors.yellow, modifier = Modifier.size(14.dp))
            Text(
                title,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (project != null) {
                // Always whole; the title is what gives way.
                Row(
                    Modifier
                        .clip(CircleShape)
                        .background(colors.faint.copy(alpha = 0.16f))
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(ProjectIcon, contentDescription = null, tint = colors.ink2, modifier = Modifier.size(12.dp))
                    Text(project, style = MaterialTheme.typography.labelMedium, color = colors.ink2, maxLines = 1, modifier = Modifier.widthIn(max = 140.dp), overflow = TextOverflow.Ellipsis)
                }
            }
            StatusGlyph(session.status, size = 15.dp)
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(
                text = { Text(pinLabel) },
                leadingIcon = { Icon(if (session.pinned) Icons.Outlined.PushPin else Icons.Filled.PushPin, contentDescription = null) },
                onClick = {
                    menu = false
                    actions.setPinned(session.id, !session.pinned)
                },
            )
            DropdownMenuItem(
                text = { Text(deleteLabel, color = colors.red) },
                leadingIcon = { Icon(Icons.Filled.Delete, contentDescription = null, tint = colors.red) },
                onClick = {
                    menu = false
                    onDelete()
                },
            )
        }
    }
}

/** Asks before deleting, since it removes the session on the desktop too. */
@Composable
fun SessionDeleteDialog(session: RemoteSessionSummary?, actions: WorkActions, onDismiss: () -> Unit) {
    if (session == null) return
    VettaConfirmDialog(
        title = stringResource(Res.string.session_delete_title),
        message = stringResource(Res.string.session_delete_message),
        confirmLabel = stringResource(Res.string.session_delete),
        onConfirm = {
            actions.delete(session.id)
            onDismiss()
        },
        onDismiss = onDismiss,
    )
}

/**
 * The list's header: "Tasks", then a status menu and, on Home, the project picker. Each
 * icon fills in while it narrows the list, so a filtered list never passes for the whole.
 */
@Composable
fun FilterBar(
    filter: SessionFilter,
    waitingCount: Int,
    onChange: (SessionFilter) -> Unit,
    modifier: Modifier = Modifier,
    onPickProject: (() -> Unit)? = null,
) {
    val haptics = LocalHapticFeedback.current
    var menu by remember { mutableStateOf(false) }
    fun change(next: SessionFilter) {
        if (next != filter) haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        onChange(next)
    }
    Row(
        modifier.fillMaxWidth().padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            stringResource(Res.string.home_tasks),
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        val statusName = filter.status?.let { groupTitle(it) } ?: stringResource(Res.string.work_status_all)
        Box {
            FilterIcon(Icons.AutoMirrored.Filled.Sort, stringResource(Res.string.home_filter_status), statusName, active = filter.status != null, tag = "filter.status") { menu = true }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                StatusOption(stringResource(Res.string.work_status_all), Icons.Outlined.Inbox, filter.status == null) {
                    menu = false
                    change(filter.withStatus(null))
                }
                SessionStatusGroup.entries.forEach { group ->
                    val count = if (group == SessionStatusGroup.Waiting && waitingCount > 0) "  $waitingCount" else ""
                    StatusOption(groupTitle(group) + count, groupIcon(group), filter.status == group) {
                        menu = false
                        change(filter.withStatus(group))
                    }
                }
            }
        }
        if (onPickProject != null) {
            FilterIcon(ProjectIcon, stringResource(Res.string.home_pick_project), null, active = filter.scope != ProjectScope.All, tag = "filter.project", onClick = onPickProject)
        }
    }
}

@Composable
private fun StatusOption(title: String, icon: ImageVector, chosen: Boolean, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(title) },
        leadingIcon = { Icon(icon, contentDescription = null) },
        trailingIcon = { if (chosen) Icon(Icons.Filled.Check, contentDescription = null) },
        onClick = onClick,
        modifier = Modifier.semantics { selected = chosen },
    )
}

@Composable
fun groupTitle(group: SessionStatusGroup): String =
    stringResource(
        when (group) {
            SessionStatusGroup.Waiting -> Res.string.work_group_waiting
            SessionStatusGroup.Processing -> Res.string.work_group_processing
            SessionStatusGroup.Done -> Res.string.work_group_done
        },
    )

private fun groupIcon(group: SessionStatusGroup): ImageVector =
    when (group) {
        SessionStatusGroup.Waiting -> Icons.Filled.QuestionMark
        SessionStatusGroup.Processing -> Icons.Filled.Sync
        SessionStatusGroup.Done -> Icons.Outlined.CheckCircle
    }

/** One of the header's filter icons: plain while it lets everything through, filled while it narrows. */
@Composable
private fun FilterIcon(icon: ImageVector, label: String, value: String?, active: Boolean, tag: String, onClick: () -> Unit) {
    val colors = MaterialTheme.workColors
    val fill by animateColorAsState(if (active) colors.pill else colors.card2, VettaMotion.snappy(), label = "filter fill")
    val ink by animateColorAsState(if (active) colors.pillInk else colors.ink2, VettaMotion.snappy(), label = "filter ink")
    Box(
        Modifier
            .size(38.dp)
            .clip(CircleShape)
            .background(fill)
            .springClickable(highlight = CircleShape, onClick = onClick)
            .semantics {
                contentDescription = label
                if (value != null) stateDescription = value
                selected = active
            }.testTag(tag),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, contentDescription = null, tint = ink, modifier = Modifier.size(18.dp)) }
}

/** A project in a list: its icon on a tile, its name, and how many sessions and how recent. */
@Composable
fun ProjectRow(project: ProjectDigest, modifier: Modifier = Modifier) {
    val colors = MaterialTheme.workColors
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(
            Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(colors.card2),
            contentAlignment = Alignment.Center,
        ) { Icon(ProjectIcon, contentDescription = null, tint = colors.ink2, modifier = Modifier.size(22.dp)) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(project.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(projectDetail(project), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
    }
}

/** Its session count, and when it was last active if the phone has seen a session of it. */
@Composable
fun projectDetail(project: ProjectDigest): String {
    val count = pluralStringResource(Res.plurals.home_session_count, project.sessionCount, project.sessionCount)
    if (project.updatedAt <= 0) return count
    return "$count · ${stringResource(Res.string.home_updated, relativeTimeLabel(project.updatedAt))}"
}

/** The floating glass button that starts a session. */
@Composable
fun NewSessionButton(onClick: () -> Unit, modifier: Modifier = Modifier) {
    GlassCapsuleButton(
        text = stringResource(Res.string.new_session_title),
        onClick = onClick,
        icon = Icons.Filled.Add,
        modifier = modifier,
        height = 56.dp,
        tag = "home.newSession",
    )
}

/**
 * A sticky list header that has no background of its own until it pins; then the page
 * colour behind it fades out downward, so the rows slide away under it.
 */
@Composable
fun PinnedHeader(listState: LazyListState, key: Any, content: @Composable (Modifier) -> Unit) {
    val pinned by remember(listState) {
        derivedStateOf {
            val header = listState.layoutInfo.visibleItemsInfo.firstOrNull { it.key == key }
            header != null && header.offset <= 0 && (listState.firstVisibleItemIndex > 0 || listState.firstVisibleItemScrollOffset > 0)
        }
    }
    val fade by animateFloatAsState(if (pinned) 1f else 0f, VettaMotion.snappy(), label = "pinned header")
    val page = MaterialTheme.vettaExtra.pageBackground
    content(
        Modifier
            .drawBehind {
                if (fade > 0f) {
                    drawRect(
                        Brush.verticalGradient(0f to page, 0.7f to page, 1f to page.copy(alpha = 0f)),
                        size = size.copy(height = size.height + 24.dp.toPx()),
                        alpha = fade,
                    )
                }
            }.padding(vertical = 10.dp),
    )
}
