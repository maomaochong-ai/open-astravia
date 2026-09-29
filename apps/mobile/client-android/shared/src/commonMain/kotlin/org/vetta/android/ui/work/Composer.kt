package org.vetta.android.ui.work

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Keyboard
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.pluralStringResource
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.work.HoldToTalk
import org.vetta.android.domain.work.PromptAttachmentError
import org.vetta.android.domain.work.PromptDraft
import org.vetta.android.resources.Res
import org.vetta.android.resources.chat_attach
import org.vetta.android.resources.chat_attach_too_large
import org.vetta.android.resources.chat_attach_too_many
import org.vetta.android.resources.chat_camera_denied
import org.vetta.android.resources.chat_camera_unavailable
import org.vetta.android.resources.chat_dictation_cancel
import org.vetta.android.resources.chat_dictation_denied
import org.vetta.android.resources.chat_dictation_hint
import org.vetta.android.resources.chat_dictation_hold
import org.vetta.android.resources.chat_dictation_keyboard
import org.vetta.android.resources.chat_dictation_listening
import org.vetta.android.resources.chat_dictation_unavailable
import org.vetta.android.resources.chat_dictation_voice
import org.vetta.android.resources.send
import org.vetta.android.resources.stop
import org.vetta.android.ui.theme.vettaExtra

/** Why something could not be attached or dictated, shown over the composer for a moment. */
private sealed interface ComposerNotice {
    data class TooLarge(val name: String) : ComposerNotice

    data object TooMany : ComposerNotice

    data object CameraUnavailable : ComposerNotice

    data object CameraDenied : ComposerNotice

    data class Dictation(val failure: DictationFailure) : ComposerNotice
}

/**
 * The composer shared by New Session and the chat, laid out like Telegram: a
 * round attach button, then the message field that grows with its text (Return
 * adds a line), then the voice button. Send appears inside the field once there is
 * something to send; while the agent works, Stop takes its place. The voice button
 * slides a "Hold to talk" button out under the field: holding it dictates, and
 * letting go puts the words in the field without sending them, to edit first.
 */
@Composable
fun Composer(
    draft: PromptDraft,
    onDraftChange: (PromptDraft) -> Unit,
    placeholder: String,
    onSend: (PromptDraft) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    busy: Boolean = false,
    onStop: () -> Unit = {},
    containerColor: Color = MaterialTheme.vettaExtra.pageBackground,
    dictation: Dictation = rememberDictation(),
    /** The desktop's skills to reference (ADR-0137); null leaves them out. */
    skills: ComposerSkills? = null,
) {
    val colors = MaterialTheme.workColors
    val scope = rememberCoroutineScope()
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val haptics = LocalHapticFeedback.current
    val cue = rememberDictationCue()
    val press = remember { HoldToTalk() }
    val focusManager = LocalFocusManager.current
    var sheet by remember { mutableStateOf(false) }
    var skillSheet by remember { mutableStateOf(false) }
    // Whether "Hold to talk" is out under the field in place of the keyboard.
    var voice by rememberSaveable { mutableStateOf(false) }
    var notice by remember { mutableStateOf<ComposerNotice?>(null) }
    var cancelArmed by remember { mutableStateOf(false) }
    val current by rememberUpdatedState(draft)
    val launchers =
        rememberAttachmentLaunchers { pick ->
            when (pick) {
                is AttachmentPick.Picked -> {
                    var next = current
                    for (attachment in pick.attachments) {
                        try {
                            next = next.adding(attachment)
                        } catch (error: PromptAttachmentError) {
                            notice =
                                when (error) {
                                    is PromptAttachmentError.TooLarge -> ComposerNotice.TooLarge(error.name)
                                    PromptAttachmentError.TooMany -> ComposerNotice.TooMany
                                }
                        }
                    }
                    onDraftChange(next)
                }
                is AttachmentPick.TooLarge -> notice = ComposerNotice.TooLarge(pick.name)
                AttachmentPick.CameraUnavailable -> notice = ComposerNotice.CameraUnavailable
                AttachmentPick.CameraDenied -> notice = ComposerNotice.CameraDenied
            }
        }

    fun handle(action: HoldToTalk.Action) {
        when (action) {
            HoldToTalk.Action.None, HoldToTalk.Action.Tap -> Unit
            HoldToTalk.Action.StartListening -> {
                keyboard?.hide()
                cancelArmed = false
                notice = null
                cue()
                scope.launch { dictation.start()?.let { notice = ComposerNotice.Dictation(it) } }
            }
            is HoldToTalk.Action.CancelArmed -> {
                cancelArmed = action.armed
                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            }
            // Let go right after listening started: a slow tap, nothing said.
            HoldToTalk.Action.TooShort -> {
                dictation.cancel()
                cancelArmed = false
            }
            is HoldToTalk.Action.Finish ->
                scope.launch {
                    if (action.insert) {
                        val heard = dictation.stop()
                        onDraftChange(current.insertingDictation(heard))
                    } else {
                        dictation.cancel()
                    }
                    cancelArmed = false
                }
        }
    }

    LaunchedEffect(notice) {
        if (notice != null) {
            delay(4_000)
            notice = null
        }
    }
    Column(
        modifier
            .fillMaxWidth()
            .background(containerColor)
            .navigationBarsPadding()
            .imePadding()
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        notice?.let {
            Text(
                noticeText(it),
                style = MaterialTheme.typography.bodySmall,
                color = colors.red,
                modifier = Modifier.padding(start = 4.dp, bottom = 6.dp).testTag("attach.notice"),
            )
        }
        if (draft.skills.isNotEmpty()) {
            SkillChips(draft.skills, skills?.displayName ?: { it.name }) { id -> onDraftChange(current.removingSkill(id)) }
        }
        if (draft.attachments.isNotEmpty()) {
            AttachmentRow(draft.attachments) { id -> onDraftChange(current.removing(id)) }
        }
        // The glow takes over the bottom while listening; the bar fades out under it.
        Row(
            Modifier.alpha(if (dictation.listening) 0.15f else 1f),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // A plain round button at the field's one-line height.
            IconButton(
                onClick = { sheet = true },
                enabled = enabled,
                modifier = Modifier.size(48.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surface).testTag("composer.attach"),
            ) { Icon(Icons.Filled.Add, contentDescription = stringResource(Res.string.chat_attach)) }
            Row(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(24.dp))
                    .background(MaterialTheme.colorScheme.surface)
                    .border(1.dp, MaterialTheme.vettaExtra.border, RoundedCornerShape(24.dp))
                    .padding(start = 16.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(Modifier.weight(1f).heightIn(min = 36.dp).padding(vertical = 8.dp), contentAlignment = Alignment.CenterStart) {
                    if (draft.text.isEmpty()) {
                        // Read out as the field's own label instead, so a screen reader names the field.
                        Text(placeholder, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.vettaExtra.secondaryText, modifier = Modifier.clearAndSetSemantics {})
                    }
                    BasicTextField(
                        value = draft.text,
                        onValueChange = { onDraftChange(current.copy(text = it)) },
                        enabled = enabled,
                        textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                        cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface),
                        maxLines = 6,
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .focusRequester(focus)
                                // Typing again puts "Hold to talk" away.
                                .onFocusChanged { if (it.isFocused) voice = false }
                                .semantics { if (draft.text.isEmpty()) contentDescription = placeholder }
                                .testTag("composer.field"),
                    )
                }
                val buttonColors = IconButtonDefaults.filledIconButtonColors(containerColor = colors.pill, contentColor = colors.pillInk)
                if (busy) {
                    FilledIconButton(onClick = onStop, enabled = enabled, modifier = Modifier.size(36.dp).testTag("composer.stop"), shape = CircleShape, colors = buttonColors) {
                        Icon(Icons.Filled.Stop, contentDescription = stringResource(Res.string.stop), modifier = Modifier.size(18.dp))
                    }
                } else {
                    AnimatedVisibility(enabled && draft.canSend, enter = fadeIn() + scaleIn(), exit = fadeOut() + scaleOut()) {
                        FilledIconButton(onClick = { onSend(draft) }, modifier = Modifier.size(36.dp).testTag("composer.send"), shape = CircleShape, colors = buttonColors) {
                            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = stringResource(Res.string.send), modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
            // Voice, or back to the keyboard while "Hold to talk" is out.
            IconButton(
                onClick = {
                    if (voice) {
                        voice = false
                        focus.requestFocus()
                        keyboard?.show()
                    } else {
                        voice = true
                        keyboard?.hide()
                        focusManager.clearFocus()
                    }
                },
                enabled = enabled,
                modifier = Modifier.size(48.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surface).testTag("composer.voice"),
            ) {
                Icon(
                    if (voice) Icons.Filled.Keyboard else Icons.Filled.Mic,
                    contentDescription = stringResource(if (voice) Res.string.chat_dictation_keyboard else Res.string.chat_dictation_voice),
                )
            }
        }
        AnimatedVisibility(voice && enabled, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
            val holdLabel = stringResource(Res.string.chat_dictation_hold)
            Box(
                Modifier
                    .padding(top = 8.dp)
                    .fillMaxWidth()
                    .height(48.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .background(if (dictation.listening) colors.pill else MaterialTheme.colorScheme.surface)
                    .border(1.dp, MaterialTheme.vettaExtra.border, RoundedCornerShape(24.dp))
                    .testTag("composer.hold")
                    .holdToTalk(press, scope, ::handle)
                    .clearAndSetSemantics { contentDescription = holdLabel },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    holdLabel,
                    style = MaterialTheme.typography.titleSmall,
                    color = if (dictation.listening) colors.pillInk else MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
    if (sheet) AttachmentSheet(launchers, onDismiss = { sheet = false }, onSkills = skills?.let { { skillSheet = true } })
    if (skillSheet && skills != null) {
        SkillSheet(skills, draft.skills, onPick = { onDraftChange(current.addingSkill(it)) }, onDismiss = { skillSheet = false })
    }
    if (dictation.listening) DictationGlow(dictation.transcript, dictation.level, cancelArmed)
}

/** Feeds the press on "Hold to talk" to [HoldToTalk]; a timer ticks it while the finger holds still. */
private fun Modifier.holdToTalk(
    press: HoldToTalk,
    scope: CoroutineScope,
    handle: (HoldToTalk.Action) -> Unit,
): Modifier =
    pointerInput(press) {
        awaitEachGesture {
            // Times come from the touch events themselves, so the press reads the same in tests.
            val down = awaitFirstDown(requireUnconsumed = false)
            down.consume()
            var last = down.uptimeMillis
            var offset = Offset.Zero
            handle(press.began(down.uptimeMillis))
            // Holding still sends no move events, so a timer checks once the hold is long enough.
            val timer =
                scope.launch {
                    delay(HoldToTalk.HOLD_DELAY_MS)
                    handle(press.moved(offset.x / density, offset.y / density, down.uptimeMillis + HoldToTalk.HOLD_DELAY_MS))
                }
            try {
                while (true) {
                    val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: break
                    change.consume()
                    last = change.uptimeMillis
                    if (!change.pressed) break
                    offset = change.position - down.position
                    handle(press.moved(offset.x / density, offset.y / density, change.uptimeMillis))
                }
            } finally {
                timer.cancel()
                handle(press.ended(last))
            }
        }
    }

/**
 * What the user is saying, shown over the bottom of the screen on a blue glow
 * that swells with their voice; grey while letting go would cancel.
 */
@Composable
private fun DictationGlow(transcript: String, level: Float, cancelArmed: Boolean) {
    val tint = if (cancelArmed) Color.Gray else Color(0xFF1478FF)
    val strength by animateFloatAsState(0.7f + 0.3f * level, tween(150), label = "glow")
    Popup(alignment = Alignment.BottomCenter, properties = PopupProperties(focusable = false)) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(380.dp)
                .background(
                    Brush.verticalGradient(
                        0f to tint.copy(alpha = 0f),
                        0.45f to tint.copy(alpha = 0.45f * strength),
                        0.75f to tint.copy(alpha = 0.85f * strength),
                        1f to tint,
                    ),
                ).testTag("dictation.glow"),
            contentAlignment = Alignment.BottomCenter,
        ) {
            Column(
                Modifier.padding(start = 28.dp, end = 28.dp, bottom = 96.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text(
                    stringResource(if (cancelArmed) Res.string.chat_dictation_cancel else Res.string.chat_dictation_hint),
                    style = MaterialTheme.typography.titleSmall,
                    color = Color.White.copy(alpha = 0.85f),
                )
                Text(
                    transcript.ifEmpty { stringResource(Res.string.chat_dictation_listening) },
                    style = MaterialTheme.typography.titleLarge,
                    color = Color.White,
                    textAlign = TextAlign.Center,
                    maxLines = 4,
                    overflow = TextOverflow.StartEllipsis,
                    modifier = Modifier.testTag("dictation.transcript"),
                )
            }
        }
    }
}

@Composable
private fun noticeText(notice: ComposerNotice): String =
    when (notice) {
        is ComposerNotice.TooLarge -> stringResource(Res.string.chat_attach_too_large, notice.name)
        ComposerNotice.TooMany -> pluralStringResource(Res.plurals.chat_attach_too_many, PromptDraft.MAX_ATTACHMENTS, PromptDraft.MAX_ATTACHMENTS)
        ComposerNotice.CameraUnavailable -> stringResource(Res.string.chat_camera_unavailable)
        ComposerNotice.CameraDenied -> stringResource(Res.string.chat_camera_denied)
        is ComposerNotice.Dictation ->
            stringResource(
                when (notice.failure) {
                    DictationFailure.Denied -> Res.string.chat_dictation_denied
                    DictationFailure.Unavailable -> Res.string.chat_dictation_unavailable
                },
            )
    }
