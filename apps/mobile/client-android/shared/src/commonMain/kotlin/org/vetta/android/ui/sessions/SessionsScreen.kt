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
import org.vetta.android.ui.i18n.Str
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
    val filters = listOf(Str.filterAll, Str.filterDesktop, Str.filterCloud)
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
                title = { Text(Str.sessionsTitle, style = MaterialTheme.typography.titleMedium) },
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
                placeholder = { Text(Str.searchSessions) },
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
                    title = if (query.isBlank()) Str.noSessions else Str.noSessionsMatch,
                    subtitle = if (query.isBlank()) Str.noSessionsHint else null,
                    icon = Icons.Default.ChatBubbleOutline,
                    actionLabel = if (query.isBlank()) Str.newConversation else null,
                    onAction = if (query.isBlank()) onNewConversation else null,
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                LazyColumn(Modifier.fillMaxSize()) {
                    itemsIndexed(filtered, key = { _, item -> item.id }) { index, item ->
                        ListRow(
                            title = item.title,
                            subtitle = "${item.sourceLabel} · ${item.timeLabel}",
                            trailing = {
                                Box {
                                    IconButton(onClick = { openMenuSessionId = item.id }) {
                                        Icon(
                                            Icons.Default.MoreVert,
                                            contentDescription = Str.sessionActions,
                                            tint = MaterialTheme.vettaExtra.secondaryText,
                                        )
                                    }
                                    DropdownMenu(
                                        expanded = openMenuSessionId == item.id,
                                        onDismissRequest = { openMenuSessionId = null },
                                    ) {
                                        DropdownMenuItem(
                                            text = { Text(Str.rename) },
                                            leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) },
                                            onClick = {
                                                openMenuSessionId = null
                                                renameTitle = item.title
                                                renameTarget = item
                                            },
                                        )
                                        DropdownMenuItem(
                                            text = { Text(Str.delete) },
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
            title = Str.renameSession,
            value = renameTitle,
            label = Str.sessionName,
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
            title = Str.deleteSession,
            message = Str.deleteSessionConfirm,
            confirmLabel = Str.delete,
            onConfirm = {
                onDeleteSession(target.id)
                deleteTarget = null
            },
            onDismiss = { deleteTarget = null },
        )
    }
}
