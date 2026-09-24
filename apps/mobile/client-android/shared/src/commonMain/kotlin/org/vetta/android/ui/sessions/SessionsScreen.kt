package org.vetta.android.ui.sessions

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.vetta.android.domain.device.SessionListItem
import org.vetta.android.ui.components.FilterChipRow
import org.vetta.android.ui.components.EmptyState
import org.vetta.android.ui.components.ListRow
import org.vetta.android.ui.components.VettaTextField
import org.vetta.android.ui.components.VettaConfirmDialog
import org.vetta.android.ui.components.VettaTextInputDialog
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.resources.Res
import org.vetta.android.resources.delete
import org.vetta.android.resources.delete_session
import org.vetta.android.resources.delete_session_confirm
import org.vetta.android.resources.filter_all
import org.vetta.android.resources.filter_cloud
import org.vetta.android.resources.filter_desktop
import org.vetta.android.resources.new_conversation
import org.vetta.android.resources.no_sessions
import org.vetta.android.resources.no_sessions_hint
import org.vetta.android.resources.no_sessions_match
import org.vetta.android.resources.rename
import org.vetta.android.resources.rename_session
import org.vetta.android.resources.search_sessions
import org.vetta.android.resources.session_actions
import org.vetta.android.resources.session_name
import org.vetta.android.resources.sessions_title
import org.vetta.android.ui.i18n.relativeTimeLabel
import org.vetta.android.ui.i18n.sessionTitle
import org.vetta.android.ui.i18n.sourceText
import org.vetta.android.ui.theme.vettaExtra

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionsScreen(
    sessions: List<SessionListItem>,
    query: String,
    filterIndex: Int,
    onQueryChange: (String) -> Unit,
    onFilterChange: (Int) -> Unit,
    onOpenSession: (SessionListItem) -> Unit,
    onNewConversation: () -> Unit,
    onRenameSession: (sessionId: String, title: String) -> Unit,
    onDeleteSession: (sessionId: String) -> Unit,
    confirmBeforeDelete: Boolean = true,
) {
    var openMenuSessionId by remember { mutableStateOf<String?>(null) }
    var renameTarget by remember { mutableStateOf<SessionListItem?>(null) }
    var deleteTarget by remember { mutableStateOf<SessionListItem?>(null) }
    var renameTitle by remember { mutableStateOf("") }
    val filters = listOf(stringResource(Res.string.filter_all), stringResource(Res.string.filter_desktop), stringResource(Res.string.filter_cloud))
    val filtered =
        sessions.filter { s ->
            val qOk = query.isBlank() || s.title.contains(query, ignoreCase = true)
            val fOk =
                when (filterIndex) {
                    1 -> !s.isCloud
                    2 -> s.isCloud
                    else -> true
                }
            qOk && fOk
        }

    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(Res.string.sessions_title), style = MaterialTheme.typography.titleMedium) },
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.vettaExtra.pageBackground,
                    ),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(horizontal = 16.dp),
        ) {
            VettaTextField(
                value = query,
                onValueChange = onQueryChange,
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                placeholder = { Text(stringResource(Res.string.search_sessions)) },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
            )
            Spacer(Modifier.height(12.dp))
            FilterChipRow(
                options = filters,
                selectedIndex = filterIndex,
                onSelect = onFilterChange,
            )
            Spacer(Modifier.height(12.dp))
            if (filtered.isEmpty()) {
                EmptyState(
                    title = if (query.isBlank()) stringResource(Res.string.no_sessions) else stringResource(Res.string.no_sessions_match),
                    subtitle = if (query.isBlank()) stringResource(Res.string.no_sessions_hint) else null,
                    icon = Icons.Default.ChatBubbleOutline,
                    actionLabel = if (query.isBlank()) stringResource(Res.string.new_conversation) else null,
                    onAction = if (query.isBlank()) onNewConversation else null,
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                LazyColumn(Modifier.fillMaxSize()) {
                    itemsIndexed(filtered, key = { _, item -> item.id }) { index, item ->
                        ListRow(
                            title = sessionTitle(item.title),
                            subtitle = "${item.sourceText()} · ${relativeTimeLabel(item.updatedAtEpochMs)}",
                            trailing = {
                                Box {
                                    IconButton(onClick = { openMenuSessionId = item.id }) {
                                        Icon(
                                            Icons.Default.MoreVert,
                                            contentDescription = stringResource(Res.string.session_actions),
                                            tint = MaterialTheme.vettaExtra.secondaryText,
                                        )
                                    }
                                    DropdownMenu(
                                        expanded = openMenuSessionId == item.id,
                                        onDismissRequest = { openMenuSessionId = null },
                                    ) {
                                        DropdownMenuItem(
                                            text = { Text(stringResource(Res.string.rename)) },
                                            leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) },
                                            onClick = {
                                                openMenuSessionId = null
                                                renameTitle = item.title
                                                renameTarget = item
                                            },
                                        )
                                        DropdownMenuItem(
                                            text = { Text(stringResource(Res.string.delete)) },
                                            leadingIcon = { Icon(Icons.Default.DeleteOutline, contentDescription = null) },
                                            onClick = {
                                                openMenuSessionId = null
                                                if (confirmBeforeDelete) {
                                                    deleteTarget = item
                                                } else {
                                                    onDeleteSession(item.id)
                                                }
                                            },
                                        )
                                    }
                                }
                            },
                            onClick = { onOpenSession(item) },
                            showDivider = index < filtered.lastIndex,
                        )
                    }
                    item { Spacer(Modifier.height(16.dp)) }
                }
            }
        }
    }

    renameTarget?.let { target ->
        VettaTextInputDialog(
            title = stringResource(Res.string.rename_session),
            value = renameTitle,
            label = stringResource(Res.string.session_name),
            onValueChange = { renameTitle = it },
            onConfirm = {
                onRenameSession(target.id, renameTitle)
                renameTarget = null
            },
            onDismiss = { renameTarget = null },
        )
    }

    deleteTarget?.let { target ->
        VettaConfirmDialog(
            title = stringResource(Res.string.delete_session),
            message = stringResource(Res.string.delete_session_confirm),
            confirmLabel = stringResource(Res.string.delete),
            onConfirm = {
                onDeleteSession(target.id)
                deleteTarget = null
            },
            onDismiss = { deleteTarget = null },
        )
    }
}
