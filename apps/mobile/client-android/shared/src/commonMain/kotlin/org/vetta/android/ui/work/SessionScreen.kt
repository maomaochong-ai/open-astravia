package org.vetta.android.ui.work

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
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
import org.vetta.android.resources.chat_compacted
import org.vetta.android.resources.chat_composer_placeholder
import org.vetta.android.resources.chat_loading_history
import org.vetta.android.resources.chat_more
import org.vetta.android.resources.chat_resync
import org.vetta.android.resources.chat_scroll_to_bottom
import org.vetta.android.resources.confirm
import org.vetta.android.resources.session_name
import org.vetta.android.resources.session_pin
import org.vetta.android.resources.session_rename
import org.vetta.android.resources.session_rename_title
import org.vetta.android.resources.session_unpin
import org.vetta.android.resources.unlinked_not_cached
import org.vetta.android.resources.unlinked_readonly
import org.vetta.android.resources.work_unpaired_scan
import org.vetta.android.ui.components.VettaTextInputDialog
import org.vetta.android.ui.design.GlassCapsuleButton
import org.vetta.android.ui.design.GlassCircleButton
import org.vetta.android.ui.design.VettaMotion
import org.vetta.android.ui.design.edgeFade
import org.vetta.android.ui.shell.DrawerButton
import org.vetta.android.ui.theme.vettaExtra

/**
 * One desktop session as a chat: its history and live turns, the composer, and
 * the title that switches model and thinking level. `sessionId` may be the local
 * id New Session opened; the mirror resolves it to the desktop's once created.
 */
@Composable
fun SessionScreen(
    sessionId: String,
    state: MirrorState,
    draft: PromptDraft,
    actions: WorkActions,
    onOpenHome: () -> Unit,
    headerActions: @Composable () -> Unit = {},
    /** Pairs again, offered while the chat is read-only after an unpairing. */
    onPair: () -> Unit = {},
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

    // Whether the chat keeps the newest line in view; off while the user reads further up.
    var following by remember { mutableStateOf(true) }
    val density = LocalDensity.current
    val slack = with(density) { FOLLOW_SLACK.toPx() }
    // Only the user's own scrolling decides: a drag stops following, and where it comes
    // to rest says whether to follow again. A follow's own animation never counts.
    LaunchedEffect(listState) {
        var dragged = false
        launch {
            listState.interactionSource.interactions.collect { interaction ->
                if (interaction is DragInteraction.Start) {
                    dragged = true
                    following = false
                }
            }
        }
        snapshotFlow { listState.isScrollInProgress }.collect { scrolling ->
            if (!scrolling && dragged) {
                dragged = false
                following = listState.distanceToBottom() < slack
            }
        }
    }

    // Changes whenever new content streams in.
    val last = transcript.items.lastOrNull()
    val lastTurn = (last as? org.vetta.android.domain.remote.TranscriptItem.Assistant)?.turn
    val scrollKey = "${transcript.items.size}-${(lastTurn?.text?.length ?: 0) + (lastTurn?.thinking?.length ?: 0) + (lastTurn?.tools?.size ?: 0)}-${transcript.pendingQuestion?.requestId}"
    LaunchedEffect(scrollKey, following) { if (following) listState.followToBottom() }
    // Kept at the end while following: the chat opens there, and a reply that grows a
    // little on every frame as it plays out is glided along with.
    LaunchedEffect(listState) {
        snapshotFlow { listState.layoutInfo.totalItemsCount to listState.distanceToBottom() }.collect { (count, gap) ->
            if (!following || listState.isScrollInProgress || count == 0) return@collect
            when {
                gap == Float.MAX_VALUE -> listState.scrollToItem(count - 1, Int.MAX_VALUE)
                gap > 0f -> listState.scrollBy(gap)
            }
        }
    }

    Column(Modifier.fillMaxSize().background(MaterialTheme.vettaExtra.pageBackground).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            DrawerButton(onOpenHome)
            Box(Modifier.weight(1f)) {
                ModelMenu(
                    sessionId = id,
                    state = state,
                    busy = active || starting,
                    onChoose = { next -> actions.configure(id, next, transcript.sessionState) },
                )
            }
            headerActions()
            SessionMenu(
                enabled = !starting,
                online = state.online,
                pinned = state.session(id)?.pinned == true,
                onResync = { actions.resync(id) },
                onRename = { renaming = state.session(id)?.title.orEmpty() },
                onTogglePin = { actions.setPinned(id, state.session(id)?.pinned != true) },
            )
        }
        Box(Modifier.weight(1f)) {
            LazyColumn(
                state = listState,
                // The conversation fades out under the title and the composer instead of running into them.
                modifier = Modifier.fillMaxSize().edgeFade(top = 12.dp, bottom = 16.dp).testTag("chat.list"),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
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
                            when {
                                transcript.loaded -> workSessionTitle(state.session(id)?.title)
                                // Unpaired and never kept on the phone: it will not load, so say so.
                                state.unlinked != null -> stringResource(Res.string.unlinked_not_cached)
                                else -> stringResource(Res.string.chat_loading_history)
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.vettaExtra.secondaryText,
                            modifier = Modifier.fillMaxWidth().padding(vertical = 64.dp),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        )
                    }
                }
            }
            // Back to the newest line, once the user has scrolled away from it.
            ScrollToBottomButton(!following && blocks.isNotEmpty(), Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp)) { following = true }
        }
        // While the agent waits on an answer, the question takes the composer's place.
        AnimatedContent(
            transcript.pendingQuestion,
            contentKey = { it?.requestId },
            transitionSpec = { (fadeIn(VettaMotion.snappy()) togetherWith fadeOut(VettaMotion.snappy())).using(SizeTransform(clip = false)) },
            label = "composer or question",
        ) { question ->
            if (state.unlinked != null) {
                // After an unpairing the chat stays readable; say why it cannot go on here.
                UnlinkedBar(onPair)
            } else if (question != null) {
                QuestionPanel(
                    request = question,
                    onSubmit = { answers -> actions.respond(id, question.requestId, answers) },
                    onCancel = { actions.respond(id, question.requestId, emptyList(), cancelled = true) },
                )
            } else {
                Composer(
                    draft = draft,
                    onDraftChange = { actions.setDraft(sessionId, it) },
                    placeholder = stringResource(Res.string.chat_composer_placeholder),
                    onSend = {
                        following = true
                        actions.send(id, it)
                    },
                    enabled = state.online && !starting,
                    busy = active,
                    onStop = { if (!starting) actions.stop(id) },
                )
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
 * underneath. Tapping it opens the model sheet, which switches either on the desktop;
 * not mid-turn, which would change the model under a running reply.
 */
@Composable
private fun ModelMenu(
    sessionId: String,
    state: MirrorState,
    busy: Boolean,
    onChoose: (ModelChoice) -> Unit,
) {
    val sessionState = state.transcript(sessionId).sessionState
    val options = state.models[sessionId].orEmpty()
    val current = options.firstOrNull { it.key == sessionState.modelKey }
    var picking by remember { mutableStateOf(false) }
    // A session New Session is still starting is titled by its prompt.
    val title =
        state.session(sessionId)?.title?.takeIf(String::isNotBlank)
            ?: (state.transcript(sessionId).items.firstOrNull() as? org.vetta.android.domain.remote.TranscriptItem.User)?.text
    ModelTitle(
        title = workSessionTitle(title),
        detail = modelDetail(sessionState, current, state.desktop?.desktopName),
        online = state.online,
        picks = options.isNotEmpty(),
        enabled = options.isNotEmpty() && !busy && state.online,
        onClick = { picking = true },
        modifier = Modifier.testTag("chat.modelMenu"),
    )
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

@Composable
private fun ScrollToBottomButton(visible: Boolean, modifier: Modifier, onClick: () -> Unit) {
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(VettaMotion.snappy()) + scaleIn(VettaMotion.bouncy(), 0.6f),
        exit = fadeOut(VettaMotion.snappy()) + scaleOut(VettaMotion.snappy(), 0.6f),
        modifier = modifier,
    ) {
        GlassCircleButton(Icons.Filled.KeyboardArrowDown, stringResource(Res.string.chat_scroll_to_bottom), onClick = onClick, size = 40.dp, tag = "chat.toBottom")
    }
}

/** How close to the end counts as being at it, so a reply resumes following. */
private val FOLLOW_SLACK = 80.dp

/** Pixels between what is shown and the end of the list; 0 at the bottom, MAX_VALUE while the last item is off screen. */
private fun LazyListState.distanceToBottom(): Float {
    val info = layoutInfo
    val last = info.visibleItemsInfo.lastOrNull() ?: return 0f
    if (last.index < info.totalItemsCount - 1) return Float.MAX_VALUE
    return (last.offset + last.size - (info.viewportEndOffset - info.afterContentPadding)).coerceAtLeast(0).toFloat()
}

/** Glides to the newest line: to the last item first if it is off screen, then to its end. */
private suspend fun LazyListState.followToBottom() {
    val count = layoutInfo.totalItemsCount
    if (count == 0) return
    if ((layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) < count - 1) scrollToItem(count - 1)
    val gap = distanceToBottom()
    if (gap > 0f && gap < Float.MAX_VALUE) animateScrollBy(gap, VettaMotion.smooth())
}

@Composable
private fun UnlinkedBar(onPair: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .testTag("chat.unlinked"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            stringResource(Res.string.unlinked_readonly),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.vettaExtra.secondaryText,
            modifier = Modifier.weight(1f),
        )
        GlassCapsuleButton(text = stringResource(Res.string.work_unpaired_scan), onClick = onPair, height = 40.dp, tag = "chat.unlinked.pair")
    }
}
