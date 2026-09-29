package org.vetta.android.ui.work

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.RemoteModelOption
import org.vetta.android.domain.work.ModelChoice
import org.vetta.android.resources.Res
import org.vetta.android.resources.chat_model
import org.vetta.android.resources.chat_models_loading
import org.vetta.android.resources.chat_thinking_level
import org.vetta.android.resources.common_done
import org.vetta.android.resources.new_session_default_model
import org.vetta.android.resources.new_session_default_model_hint
import org.vetta.android.ui.design.springClickable
import org.vetta.android.ui.theme.vettaExtra

/**
 * Model and thinking level, picked from a sheet that rises from the bottom.
 * New Session and the chat title both open it: New Session keeps the choice
 * until it sends, the chat applies each pick on the desktop right away.
 * The sheet follows each tap at once; the owner's choice may only catch up after a round trip.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModelSheet(
    options: List<RemoteModelOption>,
    initial: ModelChoice,
    onChange: (ModelChoice) -> Unit,
    onDismiss: () -> Unit,
    /** Adds a first row for the desktop's default model (New Session). */
    offersDefault: Boolean = false,
) {
    var choice by remember { mutableStateOf(initial) }
    fun update(next: ModelChoice) {
        if (next == choice) return
        choice = next
        onChange(next)
    }
    val current = options.firstOrNull { it.key == choice.modelKey }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(Res.string.chat_model), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            TextButton(onClick = onDismiss, modifier = Modifier.testTag("modelSheet.done")) { Text(stringResource(Res.string.common_done)) }
        }
        LazyColumn(Modifier.fillMaxWidth().navigationBarsPadding(), contentPadding = PaddingValues(bottom = 16.dp)) {
            val levels = choice.levels(options)
            if (levels.isNotEmpty()) {
                item { SectionTitle(stringResource(Res.string.chat_thinking_level)) }
                item {
                    LevelPicker(levels, selected = choice.thinkingLevel ?: current?.defaultThinkingLevel) { level ->
                        update(choice.copy(thinkingLevel = level))
                    }
                }
            }
            if (offersDefault) {
                item {
                    ModelRow(
                        name = stringResource(Res.string.new_session_default_model),
                        hint = stringResource(Res.string.new_session_default_model_hint),
                        selected = choice.modelKey == null,
                        tag = "modelSheet.model.default",
                    ) { update(choice.picking(null, options)) }
                }
            }
            if (options.isEmpty()) {
                item {
                    Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        Text(stringResource(Res.string.chat_models_loading), color = MaterialTheme.vettaExtra.secondaryText)
                    }
                }
            }
            ModelChoice.groups(options).forEach { group ->
                item(key = "provider-${group.provider}") { SectionTitle(group.provider) }
                items(group.models, key = { it.key }) { option ->
                    ModelRow(option.name, null, choice.modelKey == option.key, "modelSheet.model.${option.key}") {
                        update(choice.picking(option.key, options))
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.vettaExtra.secondaryText,
        modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 4.dp),
    )
}

@Composable
private fun ModelRow(name: String, hint: String?, selected: Boolean, tag: String, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .semantics { this.selected = selected }
            .padding(horizontal = 20.dp, vertical = 12.dp)
            .testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(name, style = MaterialTheme.typography.bodyLarge)
            if (hint != null) Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
        }
        if (selected) Icon(Icons.Filled.Check, contentDescription = null)
    }
}

/** The chosen model's thinking levels as a row of capsules. */
@Composable
private fun LevelPicker(levels: List<String>, selected: String?, onSelect: (String) -> Unit) {
    val colors = MaterialTheme.workColors
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(levels) { level ->
            val on = level == selected
            Text(
                levelLabel(level),
                style = MaterialTheme.typography.labelLarge,
                color = if (on) colors.pillInk else MaterialTheme.colorScheme.onSurface,
                modifier =
                    Modifier
                        .height(34.dp)
                        .clip(RoundedCornerShape(50))
                        .background(if (on) colors.pill else colors.card2)
                        .clickable { onSelect(level) }
                        .semantics { this.selected = on }
                        .padding(horizontal = 14.dp, vertical = 8.dp)
                        .testTag("modelSheet.level.$level"),
            )
        }
    }
}

/**
 * A page's title with the model and thinking level under it, as the chat and New Session
 * show it at the top; a dot tells whether the computer is online, and a chevron appears
 * once there are models to pick from. Tapping it opens the model sheet.
 */
@Composable
fun ModelTitle(
    title: String,
    detail: String,
    online: Boolean,
    picks: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    description: String? = null,
) {
    Column(
        modifier
            .clip(MaterialTheme.shapes.small)
            .springClickable(enabled = enabled, pressedScale = 0.97f, onClick = onClick)
            .then(if (description != null) Modifier.semantics { contentDescription = description } else Modifier)
            .padding(vertical = 2.dp, horizontal = 4.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Box(Modifier.size(6.dp).clip(CircleShape).background(if (online) MaterialTheme.workColors.green else MaterialTheme.workColors.faint))
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            if (picks) Icon(Icons.Filled.KeyboardArrowDown, contentDescription = null, modifier = Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
