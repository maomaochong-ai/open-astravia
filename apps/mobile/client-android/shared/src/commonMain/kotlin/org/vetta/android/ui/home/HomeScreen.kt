package org.vetta.android.ui.home

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.FilterAltOff
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.RemoteSessionSummary
import org.vetta.android.domain.remote.link.LinkIndicator
import org.vetta.android.domain.work.HomeSearch
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.domain.work.ProjectDigest
import org.vetta.android.domain.work.SessionFilter
import org.vetta.android.domain.work.SessionStatusGroup
import org.vetta.android.resources.Res
import org.vetta.android.resources.app_name
import org.vetta.android.resources.cancel
import org.vetta.android.resources.close
import org.vetta.android.resources.home_no_results
import org.vetta.android.resources.home_no_results_hint
import org.vetta.android.resources.home_search
import org.vetta.android.resources.home_search_placeholder
import org.vetta.android.resources.home_task_board
import org.vetta.android.resources.new_session_title
import org.vetta.android.resources.settings_title
import org.vetta.android.resources.work_clear_filters
import org.vetta.android.resources.work_empty
import org.vetta.android.resources.work_empty_description
import org.vetta.android.resources.work_empty_filtered
import org.vetta.android.resources.work_empty_filtered_description
import org.vetta.android.resources.work_kind_project
import org.vetta.android.ui.design.GlassCircleButton
import org.vetta.android.ui.design.GlassSurface
import org.vetta.android.ui.design.VettaMotion
import org.vetta.android.ui.design.edgeFade
import org.vetta.android.ui.design.springClickable
import org.vetta.android.ui.navigation.PlatformBackHandler
import org.vetta.android.ui.theme.vettaExtra
import org.vetta.android.ui.work.WorkActions
import org.vetta.android.ui.work.workColors

/** One of Home's ways in, above the sessions. */
data class HomeEntry(val icon: ImageVector, val title: String, val tag: String, val onClick: () -> Unit)

/**
 * The drawer over the slot (the iPhone's `HomeView`): the Vetta title and Close stay at
 * the top, then a short list of ways in and every session under a status filter that
 * sticks to the top. The link pill, Search and Settings float at the bottom, and Search
 * opens its field there, folding the top bar and the ways in away and listing matching
 * projects above the matching sessions.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun HomeScreen(
    state: MirrorState,
    filter: SessionFilter,
    onFilterChange: (SessionFilter) -> Unit,
    actions: WorkActions,
    entries: List<HomeEntry>,
    onClose: () -> Unit,
    onOpenSession: (String) -> Unit,
    onOpenProject: (String) -> Unit,
    onOpenSettings: () -> Unit,
    onRefresh: suspend () -> Unit,
    onRefreshProjects: suspend () -> Unit,
    onReconnect: () -> Unit,
    onPair: () -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    var searchActive by rememberSaveable { mutableStateOf(false) }
    val searching = searchActive || query.isNotEmpty()
    var deleting by remember { mutableStateOf<RemoteSessionSummary?>(null) }
    var pickingProject by remember { mutableStateOf(false) }
    val focus = LocalFocusManager.current
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    val rows =
        remember(state.sessions, filter, state.conversationCwd, query) {
            filter.apply(state.sessions, state.conversationCwd).filter { HomeSearch.matches(it, query) }
        }
    val projects =
        remember(state.sessions, state.projects, state.conversationCwd, query, searching) {
            if (!searching) emptyList() else ProjectDigest.all(state.sessions, state.projects, state.conversationCwd).filter { HomeSearch.matches(it, query) }
        }
    val glow = MaterialTheme.workColors.glow

    fun endSearch() {
        query = ""
        searchActive = false
        focus.clearFocus()
    }
    PlatformBackHandler(enabled = searching, onBack = ::endSearch)

    Box(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.vettaExtra.pageBackground)
            // A soft light at the top that scrolls away with the list.
            .drawBehind {
                val scrolled = if (listState.firstVisibleItemIndex == 0) listState.firstVisibleItemScrollOffset.toFloat() else size.height
                val radius = 420.dp.toPx()
                val center = Offset(size.width / 2, -scrolled)
                // Wider than tall, as the iPhone stretches it; the gradient reaches clear by its own edge.
                scale(scaleX = 1.6f, scaleY = 1f, pivot = center) {
                    drawCircle(Brush.radialGradient(listOf(glow, glow.copy(alpha = 0f)), center = center, radius = radius), radius = radius, center = center)
                }
            },
    ) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            AnimatedVisibility(
                visible = !searching,
                enter = expandVertically(VettaMotion.snappy()) + fadeIn(VettaMotion.snappy()),
                exit = shrinkVertically(VettaMotion.snappy()) + fadeOut(VettaMotion.snappy()),
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(start = 20.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        stringResource(Res.string.app_name),
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f).semantics { heading() },
                    )
                    GlassCircleButton(Icons.Filled.Close, stringResource(Res.string.close), onClick = onClose, tag = "home.close")
                }
            }
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
                modifier = Modifier.weight(1f),
            ) {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize().edgeFade(top = 0.dp, bottom = 96.dp).testTag("home.list"),
                    contentPadding = PaddingValues(bottom = 120.dp),
                ) {
                    if (searching) {
                        projectResults(projects, onOpenProject)
                    } else {
                        items(entries, key = { it.tag }) { entry -> EntryRow(entry, Modifier.animateItem()) }
                        item(key = "entries.end") { Spacer(Modifier.height(8.dp)) }
                    }
                    stickyHeader(key = "filters") {
                        PinnedHeader(listState, key = "filters") { modifier ->
                        FilterBar(
                            filter = filter,
                            waitingCount = state.count(SessionStatusGroup.Waiting),
                            onChange = onFilterChange,
                            onPickProject = { pickingProject = true },
                            modifier = modifier,
                        )
                        }
                    }
                    items(rows, key = { it.id }) { session ->
                        SessionCard(
                            session = session,
                            conversationCwd = state.conversationCwd,
                            actions = actions,
                            onOpen = { onOpenSession(session.id) },
                            onDelete = { deleting = session },
                            modifier = Modifier.animateItem(fadeInSpec = null, fadeOutSpec = null, placementSpec = VettaMotion.snappy()),
                        )
                    }
                    if (rows.isEmpty()) {
                        item(key = "empty") {
                            EmptyState(state, filter, query, onClearFilters = { onFilterChange(SessionFilter()) })
                        }
                    }
                }
            }
        }
        HomeBottomBar(
            searching = searching,
            query = query,
            onQueryChange = { query = it },
            onStartSearch = { searchActive = true },
            onEndSearch = ::endSearch,
            canSearch = state.sessions.isNotEmpty(),
            pill = { LinkPill(state.paired, state.link, onReconnect, onPair) },
            onOpenSettings = onOpenSettings,
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
    SessionDeleteDialog(deleting, actions) { deleting = null }
    if (pickingProject) {
        ProjectSheet(
            state = state,
            selection = filter.scope,
            offersAll = true,
            onPick = { onFilterChange(filter.withScope(it)) },
            onRefreshProjects = onRefreshProjects,
            onDismiss = { pickingProject = false },
        )
    }
}

/** A way in: an icon and a label, no background. */
@Composable
private fun EntryRow(entry: HomeEntry, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .springClickable(pressedScale = 0.97f, onClick = entry.onClick)
            .padding(horizontal = 20.dp, vertical = 10.dp)
            .testTag(entry.tag),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Icon(entry.icon, contentDescription = null, modifier = Modifier.size(24.dp))
        Text(entry.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
    }
}

/** Projects whose name matches, above the matching sessions. */
private fun LazyListScope.projectResults(projects: List<ProjectDigest>, onOpenProject: (String) -> Unit) {
    if (projects.isEmpty()) return
    item(key = "projects.title") {
        Text(
            stringResource(Res.string.work_kind_project),
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 20.dp, top = 12.dp, bottom = 4.dp),
        )
    }
    items(projects, key = { "project:${it.cwd}" }) { project ->
        ProjectRow(
            project,
            Modifier
                .fillMaxWidth()
                .springClickable(pressedScale = 0.98f) { onOpenProject(project.cwd) }
                .padding(horizontal = 20.dp, vertical = 4.dp)
                .testTag("search.project.${project.cwd}"),
        )
    }
}

@Composable
private fun EmptyState(state: MirrorState, filter: SessionFilter, query: String, onClearFilters: () -> Unit) {
    when {
        state.sessions.isEmpty() -> {
            // Nothing to say until the list has come back, or the link has failed.
            if (state.sessionsLoaded || LinkIndicator.of(state.link) == LinkIndicator.Offline) {
                Unavailable(Icons.Outlined.Inbox, stringResource(Res.string.work_empty), stringResource(Res.string.work_empty_description))
            }
        }
        query.isNotBlank() ->
            Unavailable(Icons.Filled.Search, stringResource(Res.string.home_no_results, query.trim()), stringResource(Res.string.home_no_results_hint))
        else ->
            Unavailable(Icons.Outlined.FilterAltOff, stringResource(Res.string.work_empty_filtered), stringResource(Res.string.work_empty_filtered_description)) {
                TextButton(onClick = onClearFilters, modifier = Modifier.testTag("filter.clear")) {
                    Text(stringResource(Res.string.work_clear_filters))
                }
            }
    }
}

/** A centred message where a list is empty, with its one action (iOS's `ContentUnavailableView`). */
@Composable
fun Unavailable(icon: ImageVector, title: String, description: String, action: (@Composable () -> Unit)? = null) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(44.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        Text(description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        if (action != null) Box(Modifier.padding(top = 4.dp)) { action() }
    }
}

/**
 * The bar floating over the list's end: the link pill, Search and Settings; while
 * searching, the search field in their place, lifted above the keyboard.
 */
@Composable
private fun HomeBottomBar(
    searching: Boolean,
    query: String,
    onQueryChange: (String) -> Unit,
    onStartSearch: () -> Unit,
    onEndSearch: () -> Unit,
    canSearch: Boolean,
    pill: @Composable () -> Unit,
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    AnimatedContent(
        searching,
        modifier = modifier.fillMaxWidth().navigationBarsPadding().imePadding().padding(start = 16.dp, end = 16.dp, bottom = 8.dp),
        transitionSpec = { fadeIn(VettaMotion.snappy()) togetherWith fadeOut(VettaMotion.snappy()) },
        label = "home bottom bar",
    ) { open ->
        if (open) {
            SearchField(query, onQueryChange, onEndSearch)
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                pill()
                Spacer(Modifier.weight(1f))
                // Nothing to search until there is a session.
                GlassCircleButton(Icons.Filled.Search, stringResource(Res.string.home_search), onClick = onStartSearch, size = 56.dp, enabled = canSearch, tag = "home.search")
                GlassCircleButton(Icons.Outlined.Settings, stringResource(Res.string.settings_title), onClick = onOpenSettings, size = 56.dp, tag = "home.settings")
            }
        }
    }
}

@Composable
private fun SearchField(query: String, onQueryChange: (String) -> Unit, onCancel: () -> Unit) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        GlassSurface(Modifier.weight(1f).height(48.dp), shape = CircleShape) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Filled.Search, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    if (query.isEmpty()) {
                        Text(stringResource(Res.string.home_search_placeholder), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                    }
                    BasicTextField(
                        value = query,
                        onValueChange = onQueryChange,
                        singleLine = true,
                        textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                        cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = { }),
                        modifier = Modifier.fillMaxWidth().focusRequester(focus).testTag("home.searchField"),
                    )
                }
                if (query.isNotEmpty()) {
                    Icon(
                        Icons.Outlined.Cancel,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(20.dp).springClickable { onQueryChange("") },
                    )
                }
            }
        }
        TextButton(onClick = onCancel, modifier = Modifier.testTag("home.searchCancel")) {
            Text(stringResource(Res.string.cancel), color = MaterialTheme.colorScheme.onSurface)
        }
    }
}

/** Home's way to the task board. */
@Composable
fun taskBoardEntry(onClick: () -> Unit) = HomeEntry(Icons.Outlined.Dashboard, stringResource(Res.string.home_task_board), "home.taskBoard", onClick)

/** Home's standard way in: a blank New Session. */
@Composable
fun newSessionEntry(onClick: () -> Unit) = HomeEntry(Icons.Outlined.EditNote, stringResource(Res.string.new_session_title), "home.newSession", onClick)
