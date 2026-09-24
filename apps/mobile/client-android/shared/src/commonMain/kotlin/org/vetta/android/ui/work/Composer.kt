package org.vetta.android.ui.work

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.jetbrains.compose.resources.pluralStringResource
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.work.PromptAttachmentError
import org.vetta.android.domain.work.PromptDraft
import org.vetta.android.resources.Res
import org.vetta.android.resources.chat_attach
import org.vetta.android.resources.chat_attach_too_large
import org.vetta.android.resources.chat_attach_too_many
import org.vetta.android.resources.chat_camera_denied
import org.vetta.android.resources.chat_camera_unavailable
import org.vetta.android.resources.send
import org.vetta.android.resources.stop
import org.vetta.android.ui.theme.vettaExtra

/** Why something could not be attached, shown over the composer for a moment. */
private sealed interface AttachNotice {
    data class TooLarge(val name: String) : AttachNotice

    data object TooMany : AttachNotice

    data object CameraUnavailable : AttachNotice

    data object CameraDenied : AttachNotice
}

/**
 * The composer shared by New Session and the chat, laid out like Telegram: a
 * round attach button, then the message field that grows with its text (Return
 * adds a line). Send appears inside the field once there is something to send;
 * while the agent works, Stop takes its place.
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
) {
    val colors = MaterialTheme.workColors
    var sheet by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<AttachNotice?>(null) }
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
                                    is PromptAttachmentError.TooLarge -> AttachNotice.TooLarge(error.name)
                                    PromptAttachmentError.TooMany -> AttachNotice.TooMany
                                }
                        }
                    }
                    onDraftChange(next)
                }
                is AttachmentPick.TooLarge -> notice = AttachNotice.TooLarge(pick.name)
                AttachmentPick.CameraUnavailable -> notice = AttachNotice.CameraUnavailable
                AttachmentPick.CameraDenied -> notice = AttachNotice.CameraDenied
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
        if (draft.attachments.isNotEmpty()) {
            AttachmentRow(draft.attachments) { id -> onDraftChange(current.removing(id)) }
        }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
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
                        Text(placeholder, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.vettaExtra.secondaryText)
                    }
                    BasicTextField(
                        value = draft.text,
                        onValueChange = { onDraftChange(current.copy(text = it)) },
                        enabled = enabled,
                        textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                        cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface),
                        maxLines = 6,
                        modifier = Modifier.fillMaxWidth().testTag("composer.field"),
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
        }
    }
    if (sheet) AttachmentSheet(launchers, onDismiss = { sheet = false })
}

@Composable
private fun noticeText(notice: AttachNotice): String =
    when (notice) {
        is AttachNotice.TooLarge -> stringResource(Res.string.chat_attach_too_large, notice.name)
        AttachNotice.TooMany -> pluralStringResource(Res.plurals.chat_attach_too_many, PromptDraft.MAX_ATTACHMENTS, PromptDraft.MAX_ATTACHMENTS)
        AttachNotice.CameraUnavailable -> stringResource(Res.string.chat_camera_unavailable)
        AttachNotice.CameraDenied -> stringResource(Res.string.chat_camera_denied)
    }
