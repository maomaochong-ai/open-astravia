package org.vetta.android.ui.work

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.QuestionMark
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.outlined.LaptopChromebook
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.RemoteSessionSummary
import org.vetta.android.domain.remote.link.LinkIndicator
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.domain.work.SessionFilter
import org.vetta.android.domain.work.SessionKind
import org.vetta.android.domain.work.SessionStatusGroup
import org.vetta.android.resources.Res
import org.vetta.android.resources.new_session_title
import org.vetta.android.resources.session_delete
import org.vetta.android.resources.session_delete_message
import org.vetta.android.resources.session_delete_title
import org.vetta.android.resources.session_pin
import org.vetta.android.resources.session_pinned
import org.vetta.android.resources.session_unpin
import org.vetta.android.resources.work_clear_filters
import org.vetta.android.resources.work_conversation
import org.vetta.android.resources.work_empty
import org.vetta.android.resources.work_empty_description
import org.vetta.android.resources.work_empty_filtered
import org.vetta.android.resources.work_empty_filtered_description
import org.vetta.android.resources.work_filter_kind
import org.vetta.android.resources.work_filter_project
import org.vetta.android.resources.work_group_done
import org.vetta.android.resources.work_group_processing
import org.vetta.android.resources.work_group_waiting
import org.vetta.android.resources.work_kind_all
import org.vetta.android.resources.work_kind_conversation
import org.vetta.android.resources.work_kind_project
import org.vetta.android.resources.work_project_all
import org.vetta.android.resources.work_status_all
import org.vetta.android.resources.work_settings_title
import org.vetta.android.resources.work_title
import org.vetta.android.resources.work_unpaired_description
import org.vetta.android.resources.work_unpaired_title
import org.vetta.android.ui.components.VettaConfirmDialog
import org.vetta.android.ui.i18n.relativeTimeLabel
import org.vetta.android.ui.theme.vettaExtra

/**
 * The desktop's sessions, newest first with pinned and waiting ones on top,
 * narrowed by status, kind and project. `pairing` is the scan button shown while
 * no desktop is paired; `headerActions` go beside the title.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkScreen(
    state: MirrorState,
    filter: SessionFilter,
    onFilterChange: (SessionFilter) -> Unit,
    actions: WorkActions,
    onOpenSession: (String) -> Unit,
    onRefresh: suspend () -> Unit,
    onReconnect: () -> Unit,
    pairing: @Composable () -> Unit,
    onNewSession: () -> Unit = {},
    onSettings: () -> Unit = {},
) {
    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(Res.string.work_title), style = MaterialTheme.typography.headlineSmall)
                        // Online is the normal case, so the title only speaks up when it is not.
                        if (state.paired && LinkIndicator.of(state.link) != LinkIndicator.Online) {
                            LinkStatusButton(state.link, onReconnect)
                        }
                    }
                },
                actions = {
                    IconButton(onClick = onSettings, modifier = Modifier.testTag("work.settings")) {
                        Icon(Icons.Outlined.Settings, contentDescription = stringResource(Res.string.work_settings_title))
                    }
                    if (state.paired) {
                        IconButton(onClick = onNewSession, modifier = Modifier.testTag("work.newSession")) {
                            Icon(Icons.Outlined.EditNote, contentDescription = stringResource(Res.string.new_session_title))
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.vettaExtra.pageBackground),
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            if (!state.paired) {
                // Nothing to mirror until a desktop is paired.
                if (state.ready) {
                    WorkEmptyState(
                        Icons.Outlined.LaptopChromebook,
                        stringResource(Res.string.work_unpaired_title),
                        stringResource(Res.string.work_unpaired_description),
                        action = pairing,
                    )
                }
            } else {
                SessionList(state, filter, onFilterChange, actions, onOpenSession, onRefresh, onNewSession)
            }
        }
    }
    MirrorErrorDialog(state.lastError, actions::clearError)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SessionList(
    state: MirrorState,
    filter: SessionFilter,
    onFilterChange: (SessionFilter) -> Unit,
    actions: WorkActions,
    onOpenSession: (String) -> Unit,
    onRefresh: suspend () -> Unit,
    onNewSession: () -> Unit,
) {
    val rows = remember(state.sessions, filter, state.conversationCwd) { filter.apply(state.sessions, state.conversationCwd) }
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    // The session whose delete is waiting on confirmation.
    var deleting by remember { mutableStateOf<RemoteSessionSummary?>(null) }
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
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(Modifier.fillMaxSize().testTag("work.list"), contentPadding = PaddingValues(bottom = 24.dp)) {
            item(key = "filters") { FilterBar(state, filter, onFilterChange) }
            items(rows, key = { it.id }) { session ->
                SessionRow(
                    session = session,
                    conversationCwd = state.conversationCwd,
                    onOpen = { onOpenSession(session.id) },
                    onTogglePin = { actions.setPinned(session.id, !session.pinned) },
                    onDelete = { deleting = session },
                    modifier = Modifier.animateItem(),
                )
            }
            if (rows.isEmpty() && (state.sessionsLoaded || LinkIndicator.of(state.link) == LinkIndicator.Offline)) {
                item(key = "empty") {
                    if (state.sessions.isEmpty()) {
                        WorkEmptyState(Icons.Filled.Inbox, stringResource(Res.string.work_empty), stringResource(Res.string.work_empty_description)) {
                            TextButton(onClick = onNewSession) { Text(stringResource(Res.string.new_session_title)) }
                        }
                    } else {
                        WorkEmptyState(
                            Icons.Filled.FilterList,
                            stringResource(Res.string.work_empty_filtered),
                            stringResource(Res.string.work_empty_filtered_description),
                        ) {
                            TextButton(onClick = { onFilterChange(SessionFilter()) }, modifier = Modifier.testTag("filter.clear")) {
                                Text(stringResource(Res.string.work_clear_filters))
                            }
                        }
                    }
                }
            }
        }
    }
    deleting?.let { session ->
        VettaConfirmDialog(
            title = stringResource(Res.string.session_delete_title),
            message = stringResource(Res.string.session_delete_message),
            confirmLabel = stringResource(Res.string.session_delete),
            onConfirm = {
                actions.delete(session.id)
                deleting = null
            },
            onDismiss = { deleting = null },
        )
    }
}

/**
 * Mail-style category row above the list: one coloured segment per status, the
 * chosen one spelled out, then menu chips for kind and project.
 */
@Composable
private fun FilterBar(state: MirrorState, filter: SessionFilter, onChange: (SessionFilter) -> Unit) {
    val colors = MaterialTheme.workColors
    val projects = remember(state.sessions, state.conversationCwd) { SessionFilter.projects(state.sessions, state.conversationCwd) }
    LazyRow(
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        item {
            AnimatedVisibility(filter.isActive, enter = fadeIn() + expandHorizontally(), exit = fadeOut() + shrinkHorizontally()) {
                val clear = stringResource(Res.string.work_clear_filters)
                Box(
                    Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(colors.card2)
                        .clickable { onChange(SessionFilter()) }
                        .semantics { contentDescription = clear }
                        .testTag("filter.clearChip"),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.Close, contentDescription = null, modifier = Modifier.size(18.dp)) }
            }
        }
        item {
            StatusSegment(stringResource(Res.string.work_status_all), Icons.Filled.Inbox, colors.pill, colors.pillInk, 0, filter.status == null, "filter.status.all") {
                onChange(filter.withStatus(null))
            }
        }
        items(SessionStatusGroup.entries) { group ->
            val (title, icon, tint) =
                when (group) {
                    SessionStatusGroup.Waiting -> Triple(stringResource(Res.string.work_group_waiting), Icons.Filled.QuestionMark, colors.yellow)
                    SessionStatusGroup.Processing -> Triple(stringResource(Res.string.work_group_processing), Icons.Filled.Sync, colors.blue)
                    SessionStatusGroup.Done -> Triple(stringResource(Res.string.work_group_done), Icons.Filled.Check, colors.green)
                }
            StatusSegment(
                title = title,
                icon = icon,
                tint = tint,
                ink = if (group == SessionStatusGroup.Waiting) Color.Black else Color.White,
                count = if (group == SessionStatusGroup.Waiting) state.count(SessionStatusGroup.Waiting) else 0,
                selected = filter.status == group,
                tag = "filter.status.${group.name.lowercase()}",
            ) { onChange(filter.withStatus(group)) }
        }
        item {
            val kinds =
                listOf(
                    null to stringResource(Res.string.work_kind_all),
                    SessionKind.Conversation to stringResource(Res.string.work_kind_conversation),
                    SessionKind.Project to stringResource(Res.string.work_kind_project),
                )
            MenuChip(
                title = kinds.first { it.first == filter.kind }.second,
                description = stringResource(Res.string.work_filter_kind),
                active = filter.kind != null,
                options = kinds.map { it.second },
                selected = kinds.indexOfFirst { it.first == filter.kind },
                tag = "filter.kind",
            ) { index -> onChange(filter.withKind(kinds[index].first)) }
        }
        if (filter.kind == SessionKind.Project) {
            item {
                val options = listOf(null to stringResource(Res.string.work_project_all)) + projects.map { it.cwd to "${it.name}  ${it.count}" }
                MenuChip(
                    title = projects.firstOrNull { it.cwd == filter.projectCwd }?.name ?: stringResource(Res.string.work_project_all),
                    description = stringResource(Res.string.work_filter_project),
                    active = filter.projectCwd != null,
                    options = options.map { it.second },
                    selected = options.indexOfFirst { it.first == filter.projectCwd },
                    tag = "filter.project",
                ) { index -> onChange(filter.withProject(options[index].first)) }
            }
        }
    }
}

/** A status category: an icon in its colour on grey, or filled with its colour and named when chosen. */
@Composable
private fun StatusSegment(
    title: String,
    icon: ImageVector,
    tint: Color,
    ink: Color,
    count: Int,
    selected: Boolean,
    tag: String,
    onSelect: () -> Unit,
) {
    val colors = MaterialTheme.workColors
    Row(
        Modifier
            .heightIn(min = 38.dp)
            .widthIn(min = 60.dp)
            .clip(CircleShape)
            .background(if (selected) tint else colors.card2)
            .clickable(onClick = onSelect)
            .semantics {
                contentDescription = if (count > 0) "$title $count" else title
                this.selected = selected
            }.padding(horizontal = if (selected) 16.dp else 12.dp, vertical = 8.dp)
            .testTag(tag),
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = if (selected) ink else tint, modifier = Modifier.size(18.dp))
        when {
            selected -> Text(title, style = MaterialTheme.typography.labelLarge, color = ink, maxLines = 1)
            count > 0 -> Text("$count", style = MaterialTheme.typography.labelLarge, color = tint)
        }
    }
}

@Composable
private fun MenuChip(
    title: String,
    description: String,
    active: Boolean,
    options: List<String>,
    selected: Int,
    tag: String,
    onSelect: (Int) -> Unit,
) {
    val colors = MaterialTheme.workColors
    var open by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier
                .heightIn(min = 38.dp)
                .clip(CircleShape)
                .background(if (active) colors.pill else colors.card2)
                .clickable { open = true }
                .semantics { contentDescription = "$description: $title" }
                .padding(horizontal = 14.dp, vertical = 8.dp)
                .testTag(tag),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                title,
                style = MaterialTheme.typography.labelLarge,
                color = if (active) colors.pillInk else MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 160.dp),
            )
            Icon(Icons.Filled.KeyboardArrowDown, contentDescription = null, tint = if (active) colors.pillInk else MaterialTheme.colorScheme.onSurface, modifier = Modifier.size(16.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEachIndexed { index, option ->
                DropdownMenuItem(
                    text = { Text(option) },
                    trailingIcon = { if (index == selected) Icon(Icons.Filled.Check, contentDescription = null) },
                    onClick = {
                        open = false
                        onSelect(index)
                    },
                )
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SessionRow(
    session: RemoteSessionSummary,
    conversationCwd: String?,
    onOpen: () -> Unit,
    onTogglePin: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.workColors
    val isConversation = session.projectCwd == conversationCwd
    var menu by remember { mutableStateOf(false) }
    val pinLabel = stringResource(if (session.pinned) Res.string.session_unpin else Res.string.session_pin)
    val deleteLabel = stringResource(Res.string.session_delete)
    Box(modifier) {
        Column {
            Row(
                Modifier
                    .fillMaxWidth()
                    .combinedClickable(onClick = onOpen, onLongClick = { menu = true })
                    .semantics {
                        // The long-press menu's actions, for screen readers.
                        customActions =
                            listOf(
                                CustomAccessibilityAction(pinLabel) {
                                    onTogglePin()
                                    true
                                },
                                CustomAccessibilityAction(deleteLabel) {
                                    onDelete()
                                    true
                                },
                            )
                    }.padding(horizontal = 16.dp, vertical = 12.dp)
                    .testTag("session.${session.id}"),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                StatusAvatar(session.status)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (session.pinned) {
                            Icon(
                                Icons.Filled.PushPin,
                                contentDescription = stringResource(Res.string.session_pinned),
                                tint = colors.yellow,
                                modifier = Modifier.size(14.dp),
                            )
                            Spacer(Modifier.size(4.dp))
                        }
                        Text(
                            workSessionTitle(session.title),
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        Text(relativeTimeLabel(session.updatedAt), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
                    }
                    session.preview?.trim()?.takeIf(String::isNotEmpty)?.let {
                        Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.vettaExtra.secondaryText, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                        Icon(
                            if (isConversation) Icons.Filled.ChatBubbleOutline else Icons.Filled.Folder,
                            contentDescription = null,
                            modifier = Modifier.size(12.dp),
                            tint = MaterialTheme.vettaExtra.secondaryText,
                        )
                        Text(
                            if (isConversation) stringResource(Res.string.work_conversation) else session.projectName,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.vettaExtra.secondaryText,
                            maxLines = 1,
                        )
                    }
                }
            }
            // Like Mail, the line starts under the text and leaves the avatar column clear.
            HorizontalDivider(Modifier.padding(start = 68.dp), color = MaterialTheme.vettaExtra.border)
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(
                text = { Text(pinLabel) },
                leadingIcon = { Icon(if (session.pinned) Icons.Outlined.PushPin else Icons.Filled.PushPin, contentDescription = null) },
                onClick = {
                    menu = false
                    onTogglePin()
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
