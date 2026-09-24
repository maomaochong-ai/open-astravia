package org.vetta.android.ui.chat

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.core.tween
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.vetta.android.core.model.ChatRole
import org.vetta.android.core.model.LlmModel
import org.vetta.android.domain.error.UiError
import org.vetta.android.domain.error.UiErrorAction
import org.vetta.android.domain.session.LocalMessage
import org.vetta.android.domain.session.MessageImage
import org.vetta.android.domain.session.MessageStatus
import org.vetta.android.domain.session.ToolTrace
import org.vetta.android.ui.components.EmptyState
import org.vetta.android.ui.components.ListRow
import org.vetta.android.ui.components.VettaErrorBanner
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.resources.Res
import org.vetta.android.resources.attach
import org.vetta.android.resources.back
import org.vetta.android.resources.background_work
import org.vetta.android.resources.channel_cloud
import org.vetta.android.resources.chat_placeholder
import org.vetta.android.resources.compacting
import org.vetta.android.resources.context_used
import org.vetta.android.resources.context_window
import org.vetta.android.resources.generated_by_desktop
import org.vetta.android.resources.hide_tool_details
import org.vetta.android.resources.image_placeholder
import org.vetta.android.resources.new_content
import org.vetta.android.resources.no_models
import org.vetta.android.resources.no_models_hint
import org.vetta.android.resources.no_sessions_hint
import org.vetta.android.resources.pair_desktop
import org.vetta.android.resources.preparing
import org.vetta.android.resources.reconnecting
import org.vetta.android.resources.remove_attachment
import org.vetta.android.resources.response_failed
import org.vetta.android.resources.response_interrupted
import org.vetta.android.resources.response_stopped
import org.vetta.android.resources.retrying
import org.vetta.android.resources.select_model
import org.vetta.android.resources.send
import org.vetta.android.resources.show_tool_details
import org.vetta.android.resources.stop
import org.vetta.android.resources.streaming
import org.vetta.android.resources.thinking
import org.vetta.android.resources.tokens_used
import org.vetta.android.resources.tool_answer
import org.vetta.android.resources.tool_arguments
import org.vetta.android.resources.tool_cancelled
import org.vetta.android.resources.tool_completed
import org.vetta.android.resources.tool_duration
import org.vetta.android.resources.tool_incomplete
import org.vetta.android.resources.tool_preparing
import org.vetta.android.resources.tool_result
import org.vetta.android.resources.tool_running
import org.vetta.android.resources.use_cloud_ai
import org.vetta.android.ui.media.imageBitmapFromBase64
import org.vetta.android.ui.media.rememberImagePicker
import org.vetta.android.ui.navigation.ChatSurface
import org.vetta.android.ui.theme.vettaExtra

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    title: String,
    surface: ChatSurface,
    messages: List<LocalMessage>,
    draft: String,
    pendingImages: List<MessageImage>,
    isStreaming: Boolean,
    streamingStatus: String? = null,
    models: List<LlmModel>,
    selectedModel: LlmModel?,
    modelPickerOpen: Boolean,
    globalError: UiError?,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
    onStop: () -> Unit,
    onBack: () -> Unit,
    onOpenModelPicker: () -> Unit,
    onCloseModelPicker: () -> Unit,
    onSelectModel: (LlmModel) -> Unit,
    onErrorAction: (UiErrorAction) -> Unit,
    onDismissError: () -> Unit,
    onImagesPicked: (List<MessageImage>) -> Unit,
    onRemovePendingImage: (String) -> Unit,
) {
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val launchPicker =
        rememberImagePicker { picked ->
            onImagesPicked(
                picked.map {
                    MessageImage(
                        id = "pending-${it.fileName}-${it.bytes.size}-${it.bytes.hashCode()}",
                        mimeType = it.mimeType,
                        fileName = it.fileName,
                        base64Data = it.toBase64(),
                    )
                },
            )
        }
    val isAtBottom by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull() ?: return@derivedStateOf true
            last.index >= info.totalItemsCount - 2
        }
    }

    LaunchedEffect(messages.size, messages.lastOrNull()?.content, messages.lastOrNull()?.status) {
        if (isAtBottom && messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.lastIndex)
        }
    }

    // A desktop conversation an earlier build kept here is history only: desktop
    // sessions continue on the desktop's own session page.
    val readOnly = surface == ChatSurface.Desktop
    val canSend =
        !isStreaming &&
            selectedModel != null &&
            (draft.isNotBlank() || pendingImages.isNotEmpty())

    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(title, maxLines = 1, style = MaterialTheme.typography.titleMedium)
                        Text(
                            if (isStreaming) {
                                streamingStatusLabel(streamingStatus)
                            } else if (surface == ChatSurface.Desktop) {
                                stringResource(Res.string.generated_by_desktop)
                            } else {
                                selectedModel?.name ?: stringResource(Res.string.channel_cloud)
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.vettaExtra.secondaryText,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.back))
                    }
                },
                actions = {
                    if (surface == ChatSurface.Cloud) {
                        TextButton(onClick = onOpenModelPicker) {
                            Text(
                                selectedModel?.name ?: stringResource(Res.string.select_model),
                                maxLines = 1,
                                style = MaterialTheme.typography.labelLarge,
                            )
                        }
                    }
                },
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.vettaExtra.pageBackground,
                    ),
            )
        },
        bottomBar = {
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surface)
                    .navigationBarsPadding()
                    .imePadding(),
            ) {
                if (globalError != null) {
                    VettaErrorBanner(
                        error = globalError,
                        onDismiss = onDismissError,
                        onAction = onErrorAction,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                }
                if (pendingImages.isNotEmpty()) {
                    PendingImageRow(
                        images = pendingImages,
                        onRemove = onRemovePendingImage,
                    )
                }
                if (!readOnly) {
                    InputDock(
                        value = draft,
                        isStreaming = isStreaming,
                        sendEnabled = canSend,
                        onValueChange = onDraftChange,
                        onSend = onSend,
                        onStop = onStop,
                        onAttach = launchPicker,
                    )
                }
            }
        },
    ) { padding ->
        Box(
            Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            if (messages.isEmpty()) {
                Column(
                    Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    EmptyState(
                        title = if (surface == ChatSurface.Cloud) stringResource(Res.string.use_cloud_ai) else stringResource(Res.string.pair_desktop),
                        subtitle = stringResource(Res.string.no_sessions_hint),
                    )
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(messages, key = { it.id }) { msg ->
                        MessageBubble(msg)
                    }
                }
                if (!isAtBottom) {
                    TextButton(
                        onClick = {
                            scope.launch {
                                listState.animateScrollToItem(messages.lastIndex)
                            }
                        },
                        modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp),
                    ) {
                        Text(stringResource(Res.string.new_content))
                    }
                }
            }
        }
    }

    if (modelPickerOpen) {
        ModalBottomSheet(
            onDismissRequest = onCloseModelPicker,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Text(stringResource(Res.string.select_model), style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(12.dp))
                if (models.isEmpty()) {
                    EmptyState(title = stringResource(Res.string.no_models), subtitle = stringResource(Res.string.no_models_hint))
                } else {
                    models.forEachIndexed { index, model ->
                        val selected = model.id == selectedModel?.id
                        val contextLabel = model.contextWindow?.let { stringResource(Res.string.context_window, it.toString()) }
                        val meta =
                            buildString {
                                if (contextLabel != null) append(contextLabel)
                                if (model.tags.isNotEmpty()) {
                                    if (isNotEmpty()) append(" · ")
                                    append(model.tags.take(3).joinToString(" / "))
                                }
                            }
                        ListRow(
                            title = model.name,
                            subtitle = meta.takeIf { it.isNotEmpty() },
                            trailing = if (selected) {
                                { Icon(Icons.Default.Check, contentDescription = null) }
                            } else {
                                null
                            },
                            onClick = { onSelectModel(model) },
                            showDivider = index < models.lastIndex,
                        )
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun PendingImageRow(
    images: List<MessageImage>,
    onRemove: (String) -> Unit,
) {
    LazyRow(
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(images, key = { it.id }) { image ->
            Box {
                val bmp = remember(image.id) { imageBitmapFromBase64(image.base64Data) }
                if (bmp != null) {
                    Image(
                        bitmap = bmp,
                        contentDescription = image.fileName ?: stringResource(Res.string.attach),
                        modifier =
                            Modifier
                                .size(72.dp)
                                .clip(RoundedCornerShape(10.dp)),
                        contentScale = ContentScale.Crop,
                    )
                } else {
                    Surface(
                        modifier = Modifier.size(72.dp),
                        shape = RoundedCornerShape(10.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant,
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Text(stringResource(Res.string.image_placeholder), style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
                IconButton(
                    onClick = { onRemove(image.id) },
                    modifier =
                        Modifier
                            .align(Alignment.TopEnd)
                            .size(28.dp),
                ) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = stringResource(Res.string.remove_attachment),
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(message: LocalMessage) {
    val isUser = message.role == ChatRole.User
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            modifier = Modifier.widthIn(max = 560.dp),
            horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
        ) {
            if (message.images.isNotEmpty()) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(message.images, key = { it.id }) { image ->
                        val bmp = remember(image.id) { imageBitmapFromBase64(image.base64Data) }
                        if (bmp != null) {
                            Image(
                                bitmap = bmp,
                                contentDescription = image.fileName ?: stringResource(Res.string.attach),
                                modifier =
                                    Modifier
                                        .size(120.dp)
                                        .clip(RoundedCornerShape(12.dp)),
                                contentScale = ContentScale.Crop,
                            )
                        }
                    }
                }
                if (message.content.isNotBlank() || message.status == MessageStatus.Streaming) {
                    Spacer(Modifier.height(6.dp))
                }
            }
            Surface(
                shape =
                    RoundedCornerShape(
                        topStart = 16.dp,
                        topEnd = 16.dp,
                        bottomStart = if (isUser) 16.dp else 4.dp,
                        bottomEnd = if (isUser) 4.dp else 16.dp,
                    ),
                color =
                    if (isUser) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.surfaceVariant
                    },
                contentColor =
                    if (isUser) {
                        MaterialTheme.colorScheme.onPrimary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
            ) {
                when {
                    isUser -> {
                        Text(
                            text =
                                message.content.ifBlank {
                                    if (message.images.isNotEmpty()) " " else ""
                                },
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                            style = MaterialTheme.typography.bodyLarge,
                        )
                    }
                    message.content.isBlank() && message.status == MessageStatus.Streaming -> {
                        Text(
                            "…",
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                            style = MaterialTheme.typography.bodyLarge,
                        )
                    }
                    message.content.isBlank() && message.status == MessageStatus.Error -> {
                        Text(
                            stringResource(Res.string.response_failed),
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                            style = MaterialTheme.typography.bodyLarge,
                        )
                    }
                    message.content.isBlank() && message.status == MessageStatus.Aborted -> {
                        Text(
                            stringResource(Res.string.response_stopped),
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                            style = MaterialTheme.typography.bodyLarge,
                        )
                    }
                    else -> {
                        MarkdownContent(
                            source = message.content,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                        )
                    }
                }
            }
            if (message.toolEvents.isNotEmpty()) {
                Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    message.toolEvents.forEach { tool ->
                        ToolTraceRow(tool)
                    }
                }
            }
            if (message.usage != null) {
                val usage = message.usage
                Text(
                    text = buildString {
                        append(stringResource(Res.string.tokens_used))
                        usage.totalTokens?.let { append(" $it") }
                        message.contextPercent?.let { append(" · ${stringResource(Res.string.context_used)} $it%") }
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.vettaExtra.secondaryText,
                    modifier = Modifier.padding(top = 4.dp, start = 4.dp, end = 4.dp),
                )
            }
            if (message.status == MessageStatus.Error && message.content.isNotBlank() && !message.errorMessage.isNullOrBlank()) {
                Text(
                    stringResource(Res.string.response_interrupted),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.vettaExtra.secondaryText,
                    modifier = Modifier.padding(top = 4.dp, start = 4.dp, end = 4.dp),
                )
            }
        }
    }
}

@Composable
private fun ToolTraceRow(tool: ToolTrace) {
    var expanded by remember(tool.toolCallId) { mutableStateOf(false) }
    val hasDetail = !tool.arguments.isNullOrBlank() || !tool.result.isNullOrBlank() || !tool.detail.isNullOrBlank()
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.42f))
                .animateContentSize(),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(enabled = hasDetail) { expanded = !expanded }
                .padding(horizontal = 10.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val presentation = presentTool(tool.toolName, tool.arguments)
            val presentationLabel = stringResource(presentation.label)
            Icon(
                imageVector = toolIcon(tool.toolName),
                contentDescription = presentationLabel,
                tint = toolTint(tool.phase),
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = buildString {
                    append(presentationLabel)
                    presentation.summary?.let {
                        append(" · ")
                        append(it)
                    }
                    append(" · ")
                    append(toolPhaseLabel(tool.phase))
                    tool.phaseLabel?.takeIf { it.isNotBlank() }?.let {
                        append(" · ")
                        append(it)
                    }
                },
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f),
            )
            if (hasDetail) {
                Icon(
                    imageVector = if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    contentDescription = if (expanded) stringResource(Res.string.hide_tool_details) else stringResource(Res.string.show_tool_details),
                    tint = MaterialTheme.vettaExtra.secondaryText,
                )
            }
        }
        AnimatedVisibility(
            visible = expanded && hasDetail,
            enter = fadeIn(tween(180)),
            exit = fadeOut(tween(140)),
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                ToolDetailSection(stringResource(Res.string.tool_arguments), tool.arguments)
                ToolDetailSection(stringResource(Res.string.tool_result), tool.result)
                parseToolQuestionResolution(tool.toolName, tool.result)?.let { resolution ->
                    Text(
                        text =
                            if (resolution.cancelled) {
                                stringResource(Res.string.tool_cancelled)
                            } else {
                                buildString {
                                    append(stringResource(Res.string.tool_answer))
                                    val selected = resolution.answers.flatMap { it.second }
                                    if (selected.isNotEmpty()) {
                                        append(": ")
                                        append(selected.joinToString("、"))
                                    }
                                }
                            },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
                tool.detail?.takeIf { it.isNotBlank() }?.let { detail ->
                    MarkdownContent(source = detail)
                }
                tool.durationMs?.let { duration ->
                    Text(
                        text = "${stringResource(Res.string.tool_duration)} ${duration}ms",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.vettaExtra.secondaryText,
                    )
                }
            }
        }
    }
}

@Composable
private fun ToolDetailSection(label: String, value: String?) {
    val content = value?.takeIf { it.isNotBlank() } ?: return
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.vettaExtra.secondaryText,
        )
        if (content.trimStart().startsWith('{') || content.trimStart().startsWith('[')) {
            CodeBlockChrome(language = "json", code = content)
        } else {
            MarkdownContent(source = content)
        }
    }
}

private fun toolIcon(name: String): ImageVector =
    when {
        name.startsWith("mcp_") -> Icons.Default.Build
        name == "read" || name == "read_file" -> Icons.Default.FolderOpen
        name == "write" || name == "write_file" || name == "edit" || name == "edit_file" -> Icons.Default.Edit
        name == "bash" || name == "shell" -> Icons.Default.Code
        name == "ask_user_question" -> Icons.AutoMirrored.Filled.HelpOutline
        name == "grep" || name == "find" || name == "ls" || name == "dir_tree" || name == "tree" -> Icons.Default.Search
        else -> Icons.Default.Build
    }

@Composable
private fun toolTint(phase: String) =
    when (phase) {
        "completed" -> MaterialTheme.colorScheme.primary
        "failed" -> MaterialTheme.colorScheme.error.copy(alpha = 0.72f)
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

@Composable
private fun toolPhaseLabel(phase: String): String =
    when (phase) {
        "generating", "arguments" -> stringResource(Res.string.tool_preparing)
        "started", "updated", "phase" -> stringResource(Res.string.tool_running)
        "completed" -> stringResource(Res.string.tool_completed)
        "failed" -> stringResource(Res.string.tool_incomplete)
        else -> phase
    }

@Composable
private fun streamingStatusLabel(status: String?): String =
    when (status) {
        "thinking" -> stringResource(Res.string.thinking)
        "reconnecting" -> stringResource(Res.string.reconnecting)
        "retrying" -> stringResource(Res.string.retrying)
        "compacting" -> stringResource(Res.string.compacting)
        "preparing" -> stringResource(Res.string.preparing)
        "background" -> stringResource(Res.string.background_work)
        else -> stringResource(Res.string.streaming)
    }

@Composable
private fun InputDock(
    value: String,
    isStreaming: Boolean,
    sendEnabled: Boolean,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    onStop: () -> Unit,
    onAttach: () -> Unit,
) {
    Surface(tonalElevation = 2.dp, shadowElevation = 4.dp) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 10.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            IconButton(onClick = onAttach, enabled = !isStreaming) {
                Icon(Icons.Default.AttachFile, contentDescription = stringResource(Res.string.attach))
            }
            Box(
                modifier =
                    Modifier
                        .weight(1f)
                        .heightIn(min = 44.dp, max = 140.dp)
                        .clip(RoundedCornerShape(18.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f))
                        .padding(horizontal = 14.dp, vertical = 10.dp),
            ) {
                if (value.isEmpty()) {
                    Text(
                        stringResource(Res.string.chat_placeholder),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    modifier = Modifier.fillMaxWidth(),
                    textStyle =
                        MaterialTheme.typography.bodyLarge.copy(
                            color = MaterialTheme.colorScheme.onSurface,
                        ),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    maxLines = 6,
                )
            }
            Spacer(Modifier.width(4.dp))
            if (isStreaming) {
                FilledIconButton(onClick = onStop) {
                    Icon(Icons.Default.Stop, contentDescription = stringResource(Res.string.stop))
                }
            } else {
                FilledIconButton(onClick = onSend, enabled = sendEnabled) {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = stringResource(Res.string.send))
                }
            }
        }
    }
}
