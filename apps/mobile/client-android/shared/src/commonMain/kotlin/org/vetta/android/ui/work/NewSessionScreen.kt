package org.vetta.android.ui.work

import androidx.compose.animation.Crossfade
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.UnfoldMore
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.domain.work.ModelChoice
import org.vetta.android.domain.work.PromptDraft
import org.vetta.android.resources.Res
import org.vetta.android.resources.back
import org.vetta.android.resources.chat_composer_placeholder
import org.vetta.android.resources.chat_model
import org.vetta.android.resources.new_session_default_model
import org.vetta.android.resources.new_session_greeting
import org.vetta.android.resources.new_session_location
import org.vetta.android.resources.new_session_offline
import org.vetta.android.resources.new_session_subtitle
import org.vetta.android.resources.work_conversation
import org.vetta.android.resources.work_kind_project
import org.vetta.android.ui.shell.DrawerButton
import org.vetta.android.ui.theme.vettaExtra

/**
 * A blank page for starting a session in a conversation or a project, with the
 * model and thinking level picked up front. Sending opens the chat at once; the
 * desktop creates the session behind it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewSessionScreen(
    state: MirrorState,
    draft: PromptDraft,
    onDraftChange: (PromptDraft) -> Unit,
    /** `null` starts in the desktop's conversations. */
    initialProjectCwd: String?,
    /** What a failed start had, put back so nothing typed or chosen is lost. */
    restored: NewSessionStart?,
    onPrepare: suspend () -> Unit,
    onStart: (NewSessionStart) -> Unit,
    onOpenHome: () -> Unit,
    onClearError: () -> Unit,
) {
    var projectCwd by rememberSaveable { mutableStateOf(restored?.projectCwd ?: initialProjectCwd) }
    // Empty keeps the desktop's default model and thinking level.
    var modelKey by rememberSaveable { mutableStateOf(restored?.modelChoice?.modelKey) }
    var thinkingLevel by rememberSaveable { mutableStateOf(restored?.modelChoice?.thinkingLevel) }
    val choice = ModelChoice(modelKey, thinkingLevel)
    val colors = MaterialTheme.workColors
    val base = MaterialTheme.vettaExtra.pageBackground

    LaunchedEffect(restored) { restored?.let { onDraftChange(it.draft) } }
    LaunchedEffect(state.online) { if (state.online) onPrepare() }

    Scaffold(
        containerColor = Color.Transparent,
        modifier =
            Modifier.background(
                // The page fades from the plain background into a deep blue glow at the bottom,
                // like dawn behind the composer. Static: nothing here needs to move.
                Brush.verticalGradient(0f to base, 0.55f to base, 0.85f to colors.dawnSide, 1f to colors.dawn),
            ),
        topBar = {
            TopAppBar(
                title = {},
                navigationIcon = { DrawerButton(onOpenHome) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent),
            )
        },
        bottomBar = {
            Composer(
                draft = draft,
                onDraftChange = onDraftChange,
                placeholder = stringResource(Res.string.chat_composer_placeholder),
                onSend = { sent -> onStart(NewSessionStart(sent, projectCwd, choice)) },
                enabled = state.online,
                containerColor = Color.Transparent,
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            BotAvatar(size = 52.dp, asleep = !state.online)
            Spacer(Modifier.height(22.dp))
            Text(stringResource(Res.string.new_session_greeting), style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
            Spacer(Modifier.height(8.dp))
            Crossfade(state.online, label = "new session subtitle") { online ->
                Text(
                    stringResource(if (online) Res.string.new_session_subtitle else Res.string.new_session_offline),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.vettaExtra.secondaryText,
                    textAlign = TextAlign.Center,
                )
            }
            Spacer(Modifier.height(28.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ModelChip(state, choice) { next ->
                    modelKey = next.modelKey
                    thinkingLevel = next.thinkingLevel
                }
                LocationChip(state, projectCwd) { projectCwd = it }
            }
        }
    }
    MirrorErrorDialog(state.lastError, onClearError)
}

@Composable
private fun ModelChip(state: MirrorState, choice: ModelChoice, onChoose: (ModelChoice) -> Unit) {
    val options = state.newSessionModels
    var picking by remember { mutableStateOf(false) }
    val name = options.firstOrNull { it.key == choice.modelKey }?.name ?: stringResource(Res.string.new_session_default_model)
    val text = choice.thinkingLevel?.let { "$name · ${levelLabel(it)}" } ?: name
    val label = stringResource(Res.string.chat_model)
    // A kept list can still be browsed offline; the sheet waits for one that is on its way.
    Chip(Icons.Filled.Memory, text, enabled = state.online || options.isNotEmpty(), description = "$label: $text", tag = "newSession.model") { picking = true }
    if (picking) ModelSheet(options, choice, onChoose, onDismiss = { picking = false }, offersDefault = true)
}

@Composable
private fun LocationChip(state: MirrorState, projectCwd: String?, onChoose: (String?) -> Unit) {
    val projects = state.projects.filterNot { it.isConversation }
    val project = projects.firstOrNull { it.cwd == projectCwd }
    var open by remember { mutableStateOf(false) }
    val conversation = stringResource(Res.string.work_conversation)
    val label = stringResource(Res.string.new_session_location)
    Box {
        Chip(
            if (project == null) Icons.Filled.ChatBubbleOutline else Icons.Filled.Folder,
            project?.name ?: conversation,
            enabled = state.online,
            description = "$label: ${project?.name ?: conversation}",
            tag = "newSession.location",
        ) { open = true }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(conversation) },
                leadingIcon = { Icon(Icons.Filled.ChatBubbleOutline, contentDescription = null) },
                trailingIcon = { if (projectCwd == null) Icon(Icons.Filled.Check, contentDescription = null) },
                onClick = {
                    open = false
                    onChoose(null)
                },
            )
            if (projects.isNotEmpty()) {
                HorizontalDivider()
                Text(
                    stringResource(Res.string.work_kind_project),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.vettaExtra.secondaryText,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                )
                projects.forEach { item ->
                    DropdownMenuItem(
                        text = { Text(item.name) },
                        leadingIcon = { Icon(Icons.Filled.Folder, contentDescription = null) },
                        trailingIcon = { if (projectCwd == item.cwd) Icon(Icons.Filled.Check, contentDescription = null) },
                        onClick = {
                            open = false
                            onChoose(item.cwd)
                        },
                    )
                }
            }
        }
    }
}

/** A picker's label on New Session: icon, current choice, chevron. */
@Composable
private fun Chip(icon: ImageVector, text: String, enabled: Boolean, description: String, tag: String, onClick: () -> Unit) {
    val colors = MaterialTheme.workColors
    val ink = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.vettaExtra.secondaryText
    Row(
        Modifier
            .heightIn(min = 40.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.8f))
            .background(colors.card2.copy(alpha = 0.4f))
            .clickable(enabled = enabled, onClick = onClick)
            .semantics { contentDescription = description }
            .padding(horizontal = 14.dp, vertical = 8.dp)
            .testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Icon(icon, contentDescription = null, tint = ink, modifier = Modifier.size(16.dp))
        Text(text, style = MaterialTheme.typography.labelLarge, color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 150.dp))
        Icon(Icons.Filled.UnfoldMore, contentDescription = null, tint = ink, modifier = Modifier.size(14.dp))
    }
}
