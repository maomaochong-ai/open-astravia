package org.vetta.android.ui.work

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.jetbrains.compose.resources.pluralStringResource
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.AttachmentKind
import org.vetta.android.domain.remote.ToolCard
import org.vetta.android.domain.remote.ToolCardStatus
import org.vetta.android.domain.remote.TranscriptAttachment
import org.vetta.android.domain.work.AgentTurn
import org.vetta.android.domain.work.TurnSegment
import org.vetta.android.domain.work.WorkStep
import org.vetta.android.resources.Res
import org.vetta.android.resources.chat_duration_ms
import org.vetta.android.resources.chat_steps_done
import org.vetta.android.resources.chat_thinking
import org.vetta.android.resources.chat_thinking_activity
import org.vetta.android.resources.chat_thinking_live
import org.vetta.android.resources.chat_tool_done
import org.vetta.android.resources.chat_tool_failed
import org.vetta.android.resources.chat_tool_generating
import org.vetta.android.resources.chat_tool_running
import org.vetta.android.resources.chat_waiting_model
import org.vetta.android.resources.chat_working
import org.vetta.android.resources.copied
import org.vetta.android.resources.copy
import org.vetta.android.ui.i18n.relativeTimeLabel
import org.vetta.android.ui.theme.vettaExtra

@Composable
fun UserBubble(text: String, attachments: List<TranscriptAttachment>, modifier: Modifier = Modifier) {
    val colors = MaterialTheme.workColors
    Column(modifier.fillMaxWidth().padding(bottom = 16.dp), horizontalAlignment = Alignment.End) {
        if (attachments.isNotEmpty()) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(bottom = 6.dp).testTag("bubble.attachments")) {
                items(attachments) { attachment ->
                    Row(
                        Modifier.clip(RoundedCornerShape(50)).background(colors.card2).padding(horizontal = 10.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            if (attachment.kind == AttachmentKind.Image) Icons.Filled.Image else Icons.Filled.Description,
                            contentDescription = null,
                            modifier = Modifier.size(14.dp),
                        )
                        Spacer(Modifier.size(4.dp))
                        Text(attachment.name, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
        SelectionContainer {
            Text(
                text,
                style = MaterialTheme.typography.bodyLarge.copy(lineHeight = 22.sp),
                color = colors.pillInk,
                modifier =
                    Modifier
                        .padding(start = 48.dp)
                        .clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp, bottomStart = 20.dp, bottomEnd = 6.dp))
                        .background(colors.pill)
                        .padding(horizontal = 16.dp, vertical = 12.dp),
            )
        }
    }
}

@Composable
fun MarkerRow(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.workColors.faint,
        modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp),
        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
    )
}

/**
 * Everything the agent did between two user messages, as the desktop shows it:
 * one header, work folded into step groups, the answer as Markdown, and a copy
 * button once the turn is over. `note` is what a live turn is doing that its
 * content does not show, e.g. a retry.
 */
@Composable
fun AgentTurnView(turn: AgentTurn, note: String?) {
    Column(
        Modifier.fillMaxWidth().padding(bottom = 20.dp).testTag("turn.${turn.id}"),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BotAvatar(size = 22.dp)
            Text("Vetta", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            turn.startedAt?.let {
                Text(relativeTimeLabel(it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
            }
            if (turn.streaming) {
                CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp)
                Text(
                    note ?: stringResource(if (turn.segments.isEmpty()) Res.string.chat_waiting_model else Res.string.chat_working),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.vettaExtra.secondaryText,
                    modifier = Modifier.testTag("turn.status"),
                )
            }
        }
        turn.segments.forEachIndexed { index, segment ->
            when (segment) {
                is TurnSegment.Work ->
                    WorkGroupView(segment.steps, live = turn.streaming && index == turn.segments.lastIndex, activity = turn.activity)
                is TurnSegment.Text -> org.vetta.android.ui.chat.MarkdownContent(segment.text)
                is TurnSegment.Error -> ErrorBlock(segment.message, segment.count)
            }
        }
        if (!turn.streaming && turn.conclusion.isNotEmpty()) CopyButton(turn.conclusion)
    }
}

@Composable
private fun ErrorBlock(message: String, count: Int) {
    val red = MaterialTheme.workColors.red
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(red.copy(alpha = 0.08f))
            .padding(12.dp)
            .testTag("turn.error"),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(Icons.Filled.Warning, contentDescription = null, tint = red, modifier = Modifier.size(16.dp))
        Text(message, style = MaterialTheme.typography.bodyMedium, color = red, modifier = Modifier.weight(1f, fill = false))
        if (count > 1) {
            Text(
                "×$count",
                style = MaterialTheme.typography.labelMedium,
                color = red,
                modifier = Modifier.clip(RoundedCornerShape(50)).background(red.copy(alpha = 0.15f)).padding(horizontal = 6.dp, vertical = 1.dp),
            )
        }
    }
}

@Composable
private fun CopyButton(text: String) {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(1_500)
            copied = false
        }
    }
    val label = stringResource(if (copied) Res.string.copied else Res.string.copy)
    Row(
        Modifier
            .clip(RoundedCornerShape(8.dp))
            .clickable {
                clipboard.setText(AnnotatedString(text))
                copied = true
            }.padding(vertical = 4.dp)
            .testTag("turn.copy"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(if (copied) Icons.Filled.Check else Icons.Filled.ContentCopy, contentDescription = null, modifier = Modifier.size(14.dp), tint = MaterialTheme.vettaExtra.secondaryText)
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
    }
}

/**
 * Consecutive thinking and tool calls folded into one row: while live it names
 * the current step, afterwards it counts them; expanding lists every step.
 */
@Composable
fun WorkGroupView(steps: List<WorkStep>, live: Boolean, activity: WorkStep?) {
    var open by rememberSaveable { mutableStateOf(false) }
    val colors = MaterialTheme.workColors
    val title =
        when {
            !live -> pluralStringResource(Res.plurals.chat_steps_done, steps.size, steps.size)
            activity is WorkStep.Thinking -> {
                val tail = activity.text.lines().lastOrNull { it.isNotBlank() } ?: activity.text
                stringResource(Res.string.chat_thinking_activity, tail.takeLast(40))
            }
            activity is WorkStep.Tool -> {
                val card = activity.card
                val summary = summarizeArgs(card.args)
                card.label ?: if (summary.isEmpty()) card.toolName else "${card.toolName} · $summary"
            }
            else -> stringResource(Res.string.chat_working)
        }
    val failed = steps.any { it is WorkStep.Tool && it.card.status == ToolCardStatus.Failed }
    val arrow by animateFloatAsState(if (open) 90f else 0f, label = "work group arrow")
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(colors.card2.copy(alpha = 0.6f))
            .animateContentSize(),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable { open = !open }
                .padding(horizontal = 12.dp, vertical = 10.dp)
                .testTag("turn.work"),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (live) {
                CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp)
            } else {
                Icon(
                    if (failed) Icons.Filled.ErrorOutline else Icons.Outlined.CheckCircle,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.vettaExtra.secondaryText,
                )
            }
            Text(
                title,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.vettaExtra.secondaryText,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Icon(Icons.Filled.KeyboardArrowRight, contentDescription = null, modifier = Modifier.size(16.dp).rotate(arrow), tint = colors.faint)
        }
        AnimatedVisibility(open) {
            Column(Modifier.padding(start = 8.dp, end = 8.dp, bottom = 4.dp)) {
                steps.forEach { step ->
                    when (step) {
                        is WorkStep.Thinking -> ThinkingBlock(step.text, live = live && step.id == activity?.id)
                        is WorkStep.Tool -> ToolCardView(step.card)
                    }
                }
            }
        }
    }
}

@Composable
fun ThinkingBlock(text: String, live: Boolean) {
    if (text.isBlank()) return
    var open by rememberSaveable { mutableStateOf(false) }
    val colors = MaterialTheme.workColors
    Column(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
        Row(
            Modifier.clickable { open = !open }.padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(Icons.Filled.Psychology, contentDescription = null, modifier = Modifier.size(14.dp), tint = MaterialTheme.vettaExtra.secondaryText)
            Text(
                stringResource(if (live) Res.string.chat_thinking_live else Res.string.chat_thinking),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.vettaExtra.secondaryText,
            )
            Icon(if (open) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, contentDescription = null, modifier = Modifier.size(14.dp), tint = colors.faint)
        }
        if (open || live) {
            Text(
                text,
                style = MaterialTheme.typography.bodyMedium.copy(lineHeight = 20.sp),
                color = colors.faint,
                maxLines = if (open) Int.MAX_VALUE else 4,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
fun ToolCardView(tool: ToolCard) {
    var open by rememberSaveable(tool.toolCallId) { mutableStateOf(false) }
    val colors = MaterialTheme.workColors
    val summary = summarizeArgs(tool.args)
    val detail = tool.result ?: tool.args
    val (badge, tint) =
        when (tool.status) {
            ToolCardStatus.Done -> (tool.label ?: stringResource(Res.string.chat_tool_done)) to colors.green
            ToolCardStatus.Failed -> stringResource(Res.string.chat_tool_failed) to colors.orange
            ToolCardStatus.Generating -> stringResource(Res.string.chat_tool_generating) to MaterialTheme.vettaExtra.secondaryText
            ToolCardStatus.Running -> (tool.label ?: stringResource(Res.string.chat_tool_running)) to MaterialTheme.vettaExtra.secondaryText
        }
    Column(
        Modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.surface)
            .animateContentSize(),
    ) {
        Row(
            Modifier.fillMaxWidth().clickable { open = !open }.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(toolIcon(tool.toolName), contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.vettaExtra.secondaryText)
            Text(
                buildAnnotatedString {
                    append(tool.toolName)
                    if (summary.isNotEmpty()) withStyle(SpanStyle(color = MaterialTheme.vettaExtra.secondaryText)) { append(": $summary") }
                },
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 13.sp),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (tool.status == ToolCardStatus.Running || tool.status == ToolCardStatus.Generating) {
                CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp)
            }
            Text(
                badge,
                style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                color = tint,
                maxLines = 1,
                modifier =
                    Modifier
                        .widthIn(max = 120.dp)
                        .clip(RoundedCornerShape(50))
                        .background(if (tint == MaterialTheme.vettaExtra.secondaryText) colors.card2 else tint.copy(alpha = 0.14f))
                        .padding(horizontal = 10.dp, vertical = 4.dp),
            )
            Icon(if (open) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, contentDescription = null, modifier = Modifier.size(14.dp), tint = colors.faint)
        }
        if (open && !detail.isNullOrEmpty()) {
            HorizontalDivider(color = MaterialTheme.vettaExtra.border)
            Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SelectionContainer {
                    Text(
                        detail,
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, lineHeight = 18.sp),
                        color = MaterialTheme.vettaExtra.secondaryText,
                        maxLines = 30,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                tool.durationMs?.let {
                    Text(
                        stringResource(Res.string.chat_duration_ms, it.toLong().toInt()),
                        style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                        color = colors.faint,
                    )
                }
            }
        }
    }
}

private fun toolIcon(toolName: String): ImageVector {
    val name = toolName.lowercase()
    return when {
        "search" in name || "fetch" in name || "web" in name -> Icons.Filled.Search
        "bash" in name || "shell" in name || "exec" in name || "terminal" in name -> Icons.Filled.Terminal
        "aggregate" in name || "data" in name || "compute" in name -> Icons.Filled.Settings
        else -> Icons.Outlined.Build
    }
}

/** First scalar argument, in the order the tool call wrote them, as the desktop's card shows it. */
internal fun summarizeArgs(args: String?): String {
    if (args.isNullOrEmpty()) return ""
    val fields = runCatching { Json.parseToJsonElement(args) as? JsonObject }.getOrNull()
    if (fields != null) {
        for (value in fields.values) {
            val primitive = value as? JsonPrimitive ?: continue
            if (primitive.isString || primitive.content.toDoubleOrNull() != null) return primitive.content.take(60)
        }
    }
    return args.take(60)
}
