package org.vetta.android.ui.sessions

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.vetta.android.domain.device.SessionListItem
import org.vetta.android.ui.components.FilterChipRow
import org.vetta.android.ui.components.VettaCard
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
) {
    val filters = listOf(Str.filterAll, Str.filterDesktop, Str.filterCloud, Str.filterFavorite)
    val filtered =
        sessions.filter { s ->
            val qOk = query.isBlank() || s.title.contains(query, ignoreCase = true)
            val fOk =
                when (filterIndex) {
                    1 -> !s.isCloud
                    2 -> s.isCloud
                    3 -> s.favorite
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
            OutlinedTextField(
                value = query,
                onValueChange = onQueryChange,
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                placeholder = { Text(Str.searchSessions) },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                colors =
                    OutlinedTextFieldDefaults.colors(
                        unfocusedBorderColor = MaterialTheme.vettaExtra.border,
                        focusedBorderColor = MaterialTheme.colorScheme.onSurface,
                    ),
                shape = MaterialTheme.shapes.medium,
            )
            Spacer(Modifier.height(12.dp))
            FilterChipRow(
                options = filters,
                selectedIndex = filterIndex,
                onSelect = onFilterChange,
            )
            Spacer(Modifier.height(12.dp))
            if (filtered.isEmpty()) {
                Text(
                    Str.noSessions,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.vettaExtra.secondaryText,
                    modifier = Modifier.padding(top = 24.dp),
                )
            } else {
                LazyColumn(Modifier.fillMaxSize()) {
                    items(filtered, key = { it.id }) { item ->
                        VettaCard(
                            modifier = Modifier.padding(vertical = 5.dp),
                            onClick = { onOpenSession(item) },
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(item.title, style = MaterialTheme.typography.bodyLarge)
                                    Spacer(Modifier.height(4.dp))
                                    Text(
                                        "${item.sourceLabel} · ${item.timeLabel}",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.vettaExtra.secondaryText,
                                    )
                                }
                                Icon(
                                    Icons.Default.ChevronRight,
                                    contentDescription = null,
                                    tint = MaterialTheme.vettaExtra.secondaryText,
                                )
                            }
                        }
                    }
                    item { Spacer(Modifier.height(16.dp)) }
                }
            }
        }
    }
}
