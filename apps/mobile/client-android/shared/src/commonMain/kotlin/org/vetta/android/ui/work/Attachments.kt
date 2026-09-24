package org.vetta.android.ui.work

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.AttachmentKind
import org.vetta.android.domain.work.PromptAttachment
import org.vetta.android.resources.Res
import org.vetta.android.resources.chat_attach_camera
import org.vetta.android.resources.chat_attach_files
import org.vetta.android.resources.chat_attach_files_hint
import org.vetta.android.resources.chat_attach_photos
import org.vetta.android.resources.chat_remove_attachment
import org.vetta.android.ui.media.imageBitmapFromBytes
import org.vetta.android.ui.theme.vettaExtra

/** What a picker brought back for the composer. */
sealed interface AttachmentPick {
    /** Pictures are already fitted to one upload; files are as picked. */
    data class Picked(val attachments: List<PromptAttachment>) : AttachmentPick

    /** A file one encrypted frame cannot carry, or a picture that would not shrink enough. */
    data class TooLarge(val name: String) : AttachmentPick

    data object CameraUnavailable : AttachmentPick

    data object CameraDenied : AttachmentPick
}

/** The platform's pickers, launched from the attachment sheet. */
class AttachmentLaunchers(
    val photos: () -> Unit,
    val camera: () -> Unit,
    val files: () -> Unit,
)

@Composable
expect fun rememberAttachmentLaunchers(onPick: (AttachmentPick) -> Unit): AttachmentLaunchers

/**
 * The attach button's sheet: Photos and Camera as tiles, then Files. The system
 * photo picker needs no access to the whole library, so unlike the iPhone app
 * there is no strip of recent pictures here.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttachmentSheet(
    launchers: AttachmentLaunchers,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp)) {
            Row(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Tile(Icons.Filled.PhotoLibrary, stringResource(Res.string.chat_attach_photos), "attach.photos") {
                    onDismiss()
                    launchers.photos()
                }
                Tile(Icons.Filled.PhotoCamera, stringResource(Res.string.chat_attach_camera), "attach.camera") {
                    onDismiss()
                    launchers.camera()
                }
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable {
                        onDismiss()
                        launchers.files()
                    }.padding(horizontal = 24.dp, vertical = 14.dp)
                    .testTag("attach.files"),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Icon(Icons.Filled.Folder, contentDescription = null)
                Column {
                    Text(stringResource(Res.string.chat_attach_files), style = MaterialTheme.typography.bodyLarge)
                    Text(stringResource(Res.string.chat_attach_files_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
                }
            }
        }
    }
}

@Composable
private fun Tile(icon: ImageVector, title: String, tag: String, onClick: () -> Unit) {
    Column(
        Modifier
            .size(width = 104.dp, height = 116.dp)
            .clip(RoundedCornerShape(26.dp))
            .background(MaterialTheme.workColors.card2)
            .clickable(onClick = onClick)
            .padding(14.dp)
            .testTag(tag),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(28.dp))
        Text(title, style = MaterialTheme.typography.labelLarge)
    }
}

/** Thumbnails for pictures and name chips for files, each with a remove button. */
@Composable
fun AttachmentRow(attachments: List<PromptAttachment>, onRemove: (String) -> Unit) {
    val colors = MaterialTheme.workColors
    LazyRow(
        Modifier.fillMaxWidth().padding(bottom = 8.dp).testTag("composer.attachments"),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(attachments, key = { it.id }) { attachment ->
            val remove = stringResource(Res.string.chat_remove_attachment, attachment.name)
            Box {
                if (attachment.kind == AttachmentKind.Image) {
                    val bitmap = remember(attachment.id) { imageBitmapFromBytes(attachment.data) }
                    Box(Modifier.size(56.dp).clip(RoundedCornerShape(12.dp)).background(colors.card2)) {
                        if (bitmap != null) Image(bitmap, contentDescription = attachment.name, contentScale = ContentScale.Crop, modifier = Modifier.size(56.dp))
                    }
                } else {
                    Row(
                        Modifier.height(56.dp).clip(RoundedCornerShape(12.dp)).background(colors.card2).padding(horizontal = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(Icons.Filled.Description, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text(attachment.name, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 140.dp))
                    }
                }
                Box(
                    Modifier
                        .align(Alignment.TopEnd)
                        .padding(2.dp)
                        .size(20.dp)
                        .clip(CircleShape)
                        .background(colors.pill.copy(alpha = 0.75f))
                        .clickable { onRemove(attachment.id) }
                        .semantics { contentDescription = remove },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.Close, contentDescription = null, tint = colors.pillInk, modifier = Modifier.size(12.dp)) }
            }
        }
    }
}
