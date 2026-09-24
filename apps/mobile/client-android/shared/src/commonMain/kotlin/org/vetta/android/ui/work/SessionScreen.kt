package org.vetta.android.ui.work

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.RemoteModelOption
import org.vetta.android.domain.remote.RemoteSessionState
import org.vetta.android.domain.work.ChatBlock
import org.vetta.android.domain.work.ChatTurns
import org.vetta.android.domain.work.MirrorError
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.domain.work.ModelChoice
import org.vetta.android.domain.work.PromptDraft
import org.vetta.android.resources.Res
import org.vetta.android.resources.back
import org.vetta.android.resources.chat_compacted
import org.vetta.android.resources.chat_composer_placeholder
import org.vetta.android.resources.chat_loading_history
import org.vetta.android.resources.chat_model
import org.vetta.android.resources.chat_more
import org.vetta.android.resources.chat_resync
import org.vetta.android.resources.confirm
import org.vetta.android.resources.session_name
import org.vetta.android.resources.session_pin
import org.vetta.android.resources.session_rename
import org.vetta.android.resources.session_rename_title
import org.vetta.android.resources.session_unpin
import org.vetta.android.ui.components.VettaTextInputDialog
import org.vetta.android.ui.theme.vettaExtra

/**
 * One desktop session as a chat: its history and live turns, the composer, and
 * the title that switches model and thinking level. `sessionId` may be the local
 * id New Session opened; the mirror resolves it to the desktop's once created.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionScreen(
    sessionId: String,
    state: MirrorState,
    draft: PromptDraft,
    actions: WorkActions,
    onBack: () -> Unit,
    headerActions: @Composable () -> Unit = {},
    /** Takes the composer's place, e.g. while the agent waits on an answer. */
    bottomOverride: (@Composable (sessionId: String) -> Unit)? = null,
) {
    // The desktop's id; a chat opened by New Session starts on a local one.
    val id = state.resolve(sessionId)
    // The first prompt of a new session is still on its way to the desktop.
    val starting = state.isStarting(sessionId)
    val transcript = state.transcript(id)
    val active = transcript.sessionState.status.isActive
    val blocks = remember(transcript.items, active) { ChatTurns.build(transcript.items, waiting = active) }
    val listState = rememberLazyListState()
    var renaming by rememberSaveable { mutableStateOf<String?>(null) }

    // A new session's history is fetched once its prompt is out; earlier, it would replace the prompt.
    LaunchedEffect(id, starting) { if (!starting) actions.open(id) }

    // Changes whenever new content streams in, to keep the latest line in view.
    val last = transcript.items.lastOrNull()
    val lastTurn = (last as? org.vetta.android.domain.remote.TranscriptItem.Assistant)?.turn
    val scrollKey = "${transcript.items.size}-${(lastTurn?.text?.length ?: 0) + (lastTurn?.thinking?.length ?: 0) + (lastTurn?.tools?.size ?: 0)}-${transcript.pendingQuestion?.requestId}"
    LaunchedEffect(scrollKey) {
        val count = listState.layoutInfo.totalItemsCount
        if (count > 0) listState.animateScrollToItem(count - 1)
    }

    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.back))
                    }
                },
                title = {
                    ModelTitle(
                        sessionId = id,
                        state = state,
                        busy = active || starting,
                        onChoose = { next -> actions.configure(id, next, transcript.sessionState) },
                    )
                },
                actions = {
                    headerActions()
                    SessionMenu(
                        enabled = !starting,
                        online = state.online,
                        pinned = state.session(id)?.pinned == true,
                        onResync = { actions.resync(id) },
                        onRename = { renaming = state.session(id)?.title.orEmpty() },
                        onTogglePin = { actions.setPinned(id, state.session(id)?.pinned != true) },
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.vettaExtra.pageBackground),
            )
        },
        bottomBar = {
            if (bottomOverride != null) {
                bottomOverride(id)
            } else {
                Composer(
                    draft = draft,
                    onDraftChange = { actions.setDraft(sessionId, it) },
                    placeholder = stringResource(Res.string.chat_composer_placeholder),
                    onSend = { actions.send(id, it) },
                    enabled = state.online && !starting,
                    busy = active,
                    onStop = { if (!starting) actions.stop(id) },
                )
            }
        },
    ) { padding ->
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize().padding(padding).testTag("chat.list"),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
        ) {
            transcript.items.firstOrNull()?.at?.let { at -> item(key = "timestamp") { MarkerRow(clockLabel(at)) } }
            items(blocks, key = { it.id }) { block ->
                when (block) {
                    is ChatBlock.User -> UserBubble(block.text, block.attachments)
                    is ChatBlock.Marker -> MarkerRow(block.text.ifEmpty { stringResource(Res.string.chat_compacted) })
                    is ChatBlock.Turn ->
                        AgentTurnView(block.turn, note = if (block.turn.streaming) activityLabel(transcript.sessionState.detail) else null)
                }
            }
            if (blocks.isEmpty()) {
                item(key = "empty") {
                    Text(
                        if (transcript.loaded) workSessionTitle(state.session(id)?.title) else stringResource(Res.string.chat_loading_history),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.vettaExtra.secondaryText,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 64.dp),
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                }
            }
        }
    }

    renaming?.let { title ->
        VettaTextInputDialog(
            title = stringResource(Res.string.session_rename_title),
            value = title,
            label = stringResource(Res.string.session_name),
            onValueChange = { renaming = it },
            onConfirm = {
                actions.rename(id, title)
                renaming = null
            },
            onDismiss = { renaming = null },
        )
    }
    MirrorErrorDialog(state.lastError, actions::clearError)
}

/**
 * The chat's title: what the session is about, with the model and thinking level
 * underneath. Tapping it opens the model sheet, which switches either on the desktop.
 */
@Composable
private fun ModelTitle(
    sessionId: String,
    state: MirrorState,
    busy: Boolean,
    onChoose: (ModelChoice) -> Unit,
) {
    val sessionState = state.transcript(sessionId).sessionState
    val options = state.models[sessionId].orEmpty()
    val current = options.firstOrNull { it.key == sessionState.modelKey }
    var picking by remember { mutableStateOf(false) }
    // Switching mid-turn would change the model under a running reply.
    val enabled = options.isNotEmpty() && !busy && state.online
    val title =
        state.session(sessionId)?.title?.takeIf(String::isNotBlank)
            ?: (state.transcript(sessionId).items.firstOrNull() as? org.vetta.android.domain.remote.TranscriptItem.User)?.text
    Column(
        Modifier
            .clip(MaterialTheme.shapes.small)
            .clickable(enabled = enabled) { picking = true }
            .padding(vertical = 2.dp)
            .testTag("chat.modelMenu"),
    ) {
        Text(workSessionTitle(title), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Box(
                Modifier
                    .size(6.dp)
                    .clip(CircleShape)
                    .background(if (state.online) MaterialTheme.workColors.green else MaterialTheme.vettaExtra.secondaryText),
            )
            Text(
                modelDetail(sessionState, current, state.desktop?.desktopName),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.vettaExtra.secondaryText,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (options.isNotEmpty()) {
                Icon(
                    Icons.Filled.KeyboardArrowDown,
                    contentDescription = stringResource(Res.string.chat_model),
                    modifier = Modifier.size(14.dp),
                    tint = MaterialTheme.vettaExtra.secondaryText,
                )
            }
        }
    }
    if (picking) {
        ModelSheet(
            options = options,
            initial = ModelChoice(sessionState.modelKey, sessionState.thinkingLevel),
            onChange = onChoose,
            onDismiss = { picking = false },
        )
    }
}

@Composable
private fun modelDetail(state: RemoteSessionState, current: RemoteModelOption?, desktopName: String?): String {
    val name = current?.name ?: state.model ?: desktopName.orEmpty()
    val level = state.thinkingLevel
    return if (level != null && current != null && current.thinkingLevels.isNotEmpty()) "$name · ${levelLabel(level)}" else name
}

@Composable
private fun SessionMenu(
    enabled: Boolean,
    online: Boolean,
    pinned: Boolean,
    onResync: () -> Unit,
    onRename: () -> Unit,
    onTogglePin: () -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }, enabled = enabled, modifier = Modifier.testTag("chat.more")) {
            Icon(Icons.Filled.MoreVert, contentDescription = stringResource(Res.string.chat_more))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(Res.string.chat_resync)) },
                leadingIcon = { Icon(Icons.Filled.Refresh, contentDescription = null) },
                onClick = {
                    open = false
                    onResync()
                },
            )
            // The desktop's own sidebar actions, so it shows the same title and pin.
            DropdownMenuItem(
                text = { Text(stringResource(Res.string.session_rename)) },
                leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                enabled = online,
                onClick = {
                    open = false
                    onRename()
                },
            )
            DropdownMenuItem(
                text = { Text(stringResource(if (pinned) Res.string.session_unpin else Res.string.session_pin)) },
                leadingIcon = { Icon(if (pinned) Icons.Filled.PushPin else Icons.Outlined.PushPin, contentDescription = null) },
                enabled = online,
                onClick = {
                    open = false
                    onTogglePin()
                },
            )
        }
    }
}

/** The alert for a failed desktop action, worded in the phone's language. */
@Composable
fun MirrorErrorDialog(error: MirrorError?, onDismiss: () -> Unit) {
    if (error == null) return
    AlertDialog(
        onDismissRequest = onDismiss,
        text = { Text(error.message()) },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(Res.string.confirm)) } },
    )
}
