package org.vetta.android.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Inventory2
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.pluralStringResource
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.work.HomeSearch
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.domain.work.ProjectDigest
import org.vetta.android.domain.work.ProjectScope
import org.vetta.android.resources.Res
import org.vetta.android.resources.home_all_sessions
import org.vetta.android.resources.home_no_results
import org.vetta.android.resources.home_no_results_hint
import org.vetta.android.resources.home_pick_project
import org.vetta.android.resources.home_search
import org.vetta.android.resources.home_session_count
import org.vetta.android.resources.work_conversation
import org.vetta.android.resources.work_kind_project
import org.vetta.android.ui.design.VettaSheet
import org.vetta.android.ui.design.springClickable
import org.vetta.android.ui.work.workColors

/**
 * The one place a project is chosen, rising from the bottom (the iPhone's
 * `ProjectSheet`): the desktop's conversations and every project, most recently active
 * first, with a search. New Session picks where to start; Home's filter adds a first row
 * for every session. It asks the desktop for projects the phone has no session for yet.
 */
@Composable
fun ProjectSheet(
    state: MirrorState,
    selection: ProjectScope,
    onPick: (ProjectScope) -> Unit,
    onDismiss: () -> Unit,
    offersAll: Boolean = false,
    onRefreshProjects: (suspend () -> Unit)? = null,
) {
    var query by remember { mutableStateOf("") }
    val searching = query.isNotBlank()
    val projects =
        remember(state.sessions, state.projects, state.conversationCwd, query) {
            ProjectDigest.all(state.sessions, state.projects, state.conversationCwd).filter { !searching || HomeSearch.matches(it, query) }
        }
    val conversationCount = state.sessions.count { it.projectCwd == state.conversationCwd }
    LaunchedEffect(state.online) { if (state.online) onRefreshProjects?.invoke() }

    VettaSheet(onDismiss = onDismiss, title = stringResource(Res.string.home_pick_project)) { close ->
        fun pick(scope: ProjectScope) {
            onPick(scope)
            close()
        }
        SheetSearchField(query, { query = it }, Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
        LazyColumn(
            Modifier.fillMaxWidth().navigationBarsPadding(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (!searching) {
                item(key = "scopes") {
                    Group {
                        if (offersAll) {
                            ScopeRow(Icons.Outlined.Inventory2, stringResource(Res.string.home_all_sessions), count(state.sessions.size), selection == ProjectScope.All, "projectSheet.all") {
                                pick(ProjectScope.All)
                            }
                        }
                        ScopeRow(Icons.Outlined.ChatBubbleOutline, stringResource(Res.string.work_conversation), count(conversationCount), selection == ProjectScope.Conversations, "projectSheet.conversations") {
                            pick(ProjectScope.Conversations)
                        }
                    }
                }
            }
            if (projects.isNotEmpty()) {
                item(key = "projects.title") {
                    Text(
                        stringResource(Res.string.work_kind_project),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 12.dp, top = 8.dp),
                    )
                }
                item(key = "projects") {
                    Group {
                        projects.forEach { project ->
                            ScopeRow(ProjectIcon, project.name, projectDetail(project), selection == ProjectScope.Project(project.cwd), "projectSheet.${project.cwd}") {
                                pick(ProjectScope.Project(project.cwd))
                            }
                        }
                    }
                }
            } else if (searching) {
                item(key = "none") { Unavailable(Icons.Filled.Search, stringResource(Res.string.home_no_results, query.trim()), stringResource(Res.string.home_no_results_hint)) }
            }
        }
    }
}

@Composable
private fun count(sessions: Int): String = pluralStringResource(Res.plurals.home_session_count, sessions, sessions)

/** Rows on one rounded card, like an iOS inset list section. */
@Composable
private fun Group(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surface)) { content() }
}

@Composable
private fun ScopeRow(icon: ImageVector, title: String, detail: String, chosen: Boolean, tag: String, onClick: () -> Unit) {
    val colors = MaterialTheme.workColors
    Row(
        Modifier
            .fillMaxWidth()
            .springClickable(pressedScale = 0.98f, onClick = onClick)
            .semantics { selected = chosen }
            .padding(horizontal = 14.dp, vertical = 10.dp)
            .testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(colors.card2), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = colors.ink2, modifier = Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
        if (chosen) Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(20.dp))
    }
}

/** A search field inside a sheet, on the card colour. */
@Composable
fun SheetSearchField(query: String, onQueryChange: (String) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .height(40.dp)
            .clip(CircleShape)
            .background(MaterialTheme.workColors.card2)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(Icons.Filled.Search, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            if (query.isEmpty()) Text(stringResource(Res.string.home_search), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            BasicTextField(
                value = query,
                onValueChange = onQueryChange,
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface),
                modifier = Modifier.fillMaxWidth().testTag("projectSheet.search"),
            )
        }
    }
}
