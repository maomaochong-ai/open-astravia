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
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.work.PromptDraft
import org.vetta.android.resources.Res
import org.vetta.android.resources.send
import org.vetta.android.resources.stop
import org.vetta.android.ui.theme.vettaExtra

/**
 * The composer shared by New Session and the chat: the message field grows
 * with its text (Return adds a line) and Send appears once there is something
 * to send. While the agent works, Stop takes Send's place.
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
) {
    val colors = MaterialTheme.workColors
    Column(
        modifier
            .fillMaxWidth()
            .background(MaterialTheme.vettaExtra.pageBackground)
            .navigationBarsPadding()
            .imePadding()
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(22.dp))
                .background(MaterialTheme.colorScheme.surface)
                .border(1.dp, MaterialTheme.vettaExtra.border, RoundedCornerShape(22.dp))
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
                    onValueChange = { onDraftChange(draft.copy(text = it)) },
                    enabled = enabled,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface),
                    maxLines = 6,
                    modifier = Modifier.fillMaxWidth().testTag("composer.field"),
                )
            }
            val canSend = enabled && draft.canSend
            when {
                busy ->
                    FilledIconButton(
                        onClick = onStop,
                        enabled = enabled,
                        modifier = Modifier.size(36.dp).testTag("composer.stop"),
                        shape = CircleShape,
                        colors = IconButtonDefaults.filledIconButtonColors(containerColor = colors.pill, contentColor = colors.pillInk),
                    ) { Icon(Icons.Filled.Stop, contentDescription = stringResource(Res.string.stop), modifier = Modifier.size(18.dp)) }
                else ->
                    AnimatedVisibility(canSend, enter = fadeIn() + scaleIn(), exit = fadeOut() + scaleOut()) {
                        FilledIconButton(
                            onClick = { onSend(draft) },
                            modifier = Modifier.size(36.dp).testTag("composer.send"),
                            shape = CircleShape,
                            colors = IconButtonDefaults.filledIconButtonColors(containerColor = colors.pill, contentColor = colors.pillInk),
                        ) { Icon(Icons.AutoMirrored.Filled.Send, contentDescription = stringResource(Res.string.send), modifier = Modifier.size(18.dp)) }
                    }
            }
        }
    }
}
