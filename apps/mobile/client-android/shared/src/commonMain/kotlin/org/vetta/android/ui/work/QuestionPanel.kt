package org.vetta.android.ui.work

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.CheckBoxOutlineBlank
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Help
import androidx.compose.material.icons.filled.RadioButtonChecked
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.RemoteQuestionAnswer
import org.vetta.android.domain.remote.RemoteQuestionOption
import org.vetta.android.domain.remote.RemoteQuestionRequest
import org.vetta.android.domain.work.QuestionDraft
import org.vetta.android.resources.Res
import org.vetta.android.resources.cancel
import org.vetta.android.resources.chat_question_multi_hint
import org.vetta.android.resources.chat_question_next
import org.vetta.android.resources.chat_question_other
import org.vetta.android.resources.chat_question_other_placeholder
import org.vetta.android.resources.chat_question_submit
import org.vetta.android.resources.chat_question_tab
import org.vetta.android.resources.chat_question_title
import org.vetta.android.ui.theme.vettaExtra

/**
 * Takes the composer's place while the agent waits on an AskUserQuestion, like
 * the desktop's question panel: tabs for several questions, single or multiple
 * choice, a free-text "Other", then Next / Submit or Cancel.
 */
@Composable
fun QuestionPanel(
    request: RemoteQuestionRequest,
    onSubmit: (List<RemoteQuestionAnswer>) -> Unit,
    onCancel: () -> Unit,
) {
    var draft by remember(request.requestId) { mutableStateOf(QuestionDraft(request)) }
    var submitted by remember(request.requestId) { mutableStateOf(false) }
    if (draft.count == 0) return
    val colors = MaterialTheme.workColors
    val index = draft.current
    val question = draft.request.questions[index]
    Column(
        Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .imePadding()
            .padding(start = 12.dp, end = 12.dp, bottom = 8.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, colors.orange.copy(alpha = 0.35f), RoundedCornerShape(24.dp))
            .padding(16.dp)
            .animateContentSize()
            .testTag("question.panel"),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Filled.Help, contentDescription = null, tint = colors.orange, modifier = Modifier.size(18.dp))
            Text(stringResource(Res.string.chat_question_title), style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            if (draft.count > 1) {
                Text("${draft.answeredCount}/${draft.count}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
            }
        }
        if (draft.count > 1) Tabs(draft) { draft = draft.showing(it) }
        AnimatedContent(index, label = "question") { shown ->
            val item = draft.request.questions[shown]
            Column(
                Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (draft.count == 1 && item.header.isNotEmpty()) {
                    Text(
                        item.header,
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.clip(CircleShape).background(colors.card2).padding(horizontal = 8.dp, vertical = 3.dp),
                    )
                }
                Text(item.question, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                if (item.multiSelect) {
                    Text(stringResource(Res.string.chat_question_multi_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
                }
                item.options.forEach { option ->
                    OptionRow(option, draft.isSelected(option.label, shown), item.multiSelect) { draft = draft.toggle(option.label, shown) }
                }
                OtherRow(
                    active = draft.isOtherActive(shown),
                    multi = item.multiSelect,
                    text = draft.otherText(shown),
                    onToggle = { draft = draft.toggleOther(shown) },
                    onText = { draft = draft.settingOtherText(it, shown) },
                )
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End)) {
            OutlinedButton(onClick = onCancel, enabled = !submitted, modifier = Modifier.testTag("question.cancel")) {
                Text(stringResource(Res.string.cancel))
            }
            val primary = ButtonDefaults.buttonColors(containerColor = colors.pill, contentColor = colors.pillInk)
            if (draft.count > 1 && !draft.isLast) {
                Button(onClick = { draft = draft.next() }, enabled = draft.isAnswered(index), colors = primary, modifier = Modifier.testTag("question.next")) {
                    Text(stringResource(Res.string.chat_question_next))
                }
            } else {
                Button(
                    onClick = {
                        submitted = true
                        onSubmit(draft.result)
                    },
                    enabled = draft.allAnswered && !submitted,
                    colors = primary,
                    modifier = Modifier.testTag("question.submit"),
                ) { Text(stringResource(Res.string.chat_question_submit)) }
            }
        }
    }
}

@Composable
private fun Tabs(draft: QuestionDraft, onSelect: (Int) -> Unit) {
    val colors = MaterialTheme.workColors
    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        itemsIndexed(draft.request.questions) { index, item ->
            val current = index == draft.current
            Row(
                Modifier
                    .clip(CircleShape)
                    .background(if (current) colors.pill else colors.card2)
                    .clickable { onSelect(index) }
                    .semantics { selected = current }
                    .padding(horizontal = 10.dp, vertical = 6.dp)
                    .testTag("question.tab.$index"),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                val ink = if (current) colors.pillInk else MaterialTheme.colorScheme.onSurface
                if (draft.isAnswered(index)) Icon(Icons.Filled.Check, contentDescription = null, tint = ink, modifier = Modifier.size(14.dp))
                Text(
                    item.header.ifEmpty { stringResource(Res.string.chat_question_tab, index + 1) },
                    style = MaterialTheme.typography.labelMedium,
                    color = ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun OptionRow(option: RemoteQuestionOption, active: Boolean, multi: Boolean, onToggle: () -> Unit) {
    val colors = MaterialTheme.workColors
    val ink = MaterialTheme.colorScheme.onSurface
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(if (active) ink.copy(alpha = 0.08f) else colors.card2.copy(alpha = 0.6f))
            .border(1.dp, if (active) ink else Color.Transparent, RoundedCornerShape(14.dp))
            .clickable(onClick = onToggle)
            .semantics { selected = active }
            .padding(12.dp)
            .testTag("question.option.${option.label}"),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(marker(active, multi), contentDescription = null, tint = if (active) ink else MaterialTheme.vettaExtra.secondaryText, modifier = Modifier.size(20.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(option.label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            if (option.description.isNotEmpty()) {
                Text(option.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
            }
        }
    }
}

@Composable
private fun OtherRow(active: Boolean, multi: Boolean, text: String, onToggle: () -> Unit, onText: (String) -> Unit) {
    val ink = MaterialTheme.colorScheme.onSurface
    val outline = if (active) ink else MaterialTheme.vettaExtra.secondaryText.copy(alpha = 0.4f)
    val focus = remember { FocusRequester() }
    LaunchedEffect(active) { if (active) runCatching { focus.requestFocus() } }
    Column(
        Modifier
            .fillMaxWidth()
            .drawBehind {
                drawRoundRect(
                    color = outline,
                    cornerRadius = CornerRadius(14.dp.toPx()),
                    style = Stroke(1.dp.toPx(), pathEffect = if (active) null else PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx()))),
                )
            }.padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().clickable(onClick = onToggle).testTag("question.other"),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                if (active) marker(true, multi) else Icons.Filled.Edit,
                contentDescription = null,
                tint = if (active) ink else MaterialTheme.vettaExtra.secondaryText,
                modifier = Modifier.size(20.dp),
            )
            Text(stringResource(Res.string.chat_question_other), style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.weight(1f))
        }
        if (active) {
            TextField(
                value = text,
                onValueChange = onText,
                placeholder = { Text(stringResource(Res.string.chat_question_other_placeholder)) },
                maxLines = 4,
                colors = TextFieldDefaults.colors(focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent),
                modifier = Modifier.fillMaxWidth().focusRequester(focus).testTag("question.otherField"),
            )
        }
    }
}

private fun marker(active: Boolean, multi: Boolean) =
    if (multi) {
        if (active) Icons.Filled.CheckBox else Icons.Filled.CheckBoxOutlineBlank
    } else {
        if (active) Icons.Filled.RadioButtonChecked else Icons.Filled.RadioButtonUnchecked
    }
