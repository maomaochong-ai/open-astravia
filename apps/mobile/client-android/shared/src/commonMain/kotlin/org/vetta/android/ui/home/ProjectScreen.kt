package org.vetta.android.ui.home

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.FilterAltOff
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.RemoteSessionSummary
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.domain.work.SessionFilter
import org.vetta.android.domain.work.SessionKind
import org.vetta.android.domain.work.SessionStatusGroup
import org.vetta.android.resources.Res
import org.vetta.android.resources.back
import org.vetta.android.resources.work_clear_filters
import org.vetta.android.resources.work_empty
import org.vetta.android.resources.work_empty_description
import org.vetta.android.resources.work_empty_filtered
import org.vetta.android.resources.work_empty_filtered_description
import org.vetta.android.ui.design.GlassCircleButton
import org.vetta.android.ui.design.VettaMotion
import org.vetta.android.ui.design.edgeFade
import org.vetta.android.ui.theme.vettaExtra
import org.vetta.android.ui.work.WorkActions

/** One project's sessions, filtered by status (the iPhone's `ProjectView`); New Session starts in this project. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ProjectScreen(
    cwd: String,
    state: MirrorState,
    actions: WorkActions,
    onBack: () -> Unit,
    onOpenSession: (String) -> Unit,
    onNewSession: () -> Unit,
    onRefresh: suspend () -> Unit,
) {
    var status by rememberSaveable { mutableStateOf<SessionStatusGroup?>(null) }
    val filter = SessionFilter(status, SessionKind.Project, cwd)
    val rows = remember(state.sessions, status, state.conversationCwd) { filter.apply(state.sessions, state.conversationCwd) }
    val name =
        state.sessions.firstOrNull { it.projectCwd == cwd }?.projectName
            ?: state.projects.firstOrNull { it.cwd == cwd }?.name
            ?: cwd.trimEnd('/', '\\').substringAfterLast('/').substringAfterLast('\\')
    var deleting by remember { mutableStateOf<RemoteSessionSummary?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val page = MaterialTheme.vettaExtra.pageBackground
    val listState = rememberLazyListState()

    Box(Modifier.fillMaxSize().background(page).testTag("project.$cwd")) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                GlassCircleButton(Icons.AutoMirrored.Filled.ArrowBack, stringResource(Res.string.back), onClick = onBack, size = 44.dp, tag = "project.back")
            }
            Text(
                name,
                style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp).semantics { heading() },
            )
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
                LazyColumn(state = listState, modifier = Modifier.fillMaxSize().edgeFade(top = 0.dp, bottom = 96.dp), contentPadding = PaddingValues(bottom = 120.dp)) {
                    stickyHeader(key = "filters") {
                        PinnedHeader(listState, key = "filters") { modifier ->
                        FilterBar(
                            filter = filter,
                            waitingCount = rows.count { SessionStatusGroup.of(it.status) == SessionStatusGroup.Waiting },
                            onChange = { status = it.status },
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
                            showsProject = false,
                            modifier = Modifier.animateItem(fadeInSpec = null, fadeOutSpec = null, placementSpec = VettaMotion.snappy()),
                        )
                    }
                    if (rows.isEmpty() && state.sessionsLoaded) {
                        item(key = "empty") {
                            if (status == null) {
                                Unavailable(Icons.Outlined.Inbox, stringResource(Res.string.work_empty), stringResource(Res.string.work_empty_description))
                            } else {
                                Unavailable(Icons.Outlined.FilterAltOff, stringResource(Res.string.work_empty_filtered), stringResource(Res.string.work_empty_filtered_description)) {
                                    TextButton(onClick = { status = null }) { Text(stringResource(Res.string.work_clear_filters)) }
                                }
                            }
                        }
                    }
                }
            }
        }
        NewSessionButton(onNewSession, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 12.dp))
    }
    SessionDeleteDialog(deleting, actions) { deleting = null }
}
