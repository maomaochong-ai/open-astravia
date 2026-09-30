package org.vetta.android.ui.work

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.outlined.AudioFile
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.FolderZip
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material.icons.outlined.Slideshow
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material.icons.outlined.TableChart
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.RemoteFileEntry
import org.vetta.android.domain.remote.RemoteFileInfo
import org.vetta.android.domain.work.FileCategory
import org.vetta.android.domain.work.FileContent
import org.vetta.android.domain.work.FileNames
import org.vetta.android.domain.work.FileViewError
import org.vetta.android.domain.work.FileViewException
import org.vetta.android.resources.Res
import org.vetta.android.resources.back
import org.vetta.android.resources.files_empty
import org.vetta.android.resources.files_error_failed
import org.vetta.android.resources.files_error_forbidden
import org.vetta.android.resources.files_error_not_a_file
import org.vetta.android.resources.files_error_not_found
import org.vetta.android.resources.files_error_offline
import org.vetta.android.resources.files_error_too_large
import org.vetta.android.resources.files_error_unsupported_desktop
import org.vetta.android.resources.files_loading
import org.vetta.android.resources.files_refresh
import org.vetta.android.resources.files_retry
import org.vetta.android.resources.files_root
import org.vetta.android.resources.files_title
import org.vetta.android.ui.i18n.relativeTimeLabel
import org.vetta.android.ui.theme.vettaExtra

/** What the file views need from the desktop, each throwing [FileViewException]. */
interface FileSource {
    suspend fun list(path: String): List<RemoteFileEntry>

    suspend fun stat(href: String): RemoteFileInfo

    suspend fun read(info: RemoteFileInfo): FileContent
}

/**
 * The session's working directory, read-only, as the desktop's files panel shows it
 * (ADR-0139): folders first, a way up, and a tap on a file previews it. What the agent
 * wrote shows up once its turn ends (`active` falling back), or on refresh; a live watch
 * would cost the desktop for every phone.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilesPanel(source: FileSource, onOpenFile: (String) -> Unit, onDismiss: () -> Unit, active: Boolean = false) {
    var path by remember { mutableStateOf("") }
    var reload by remember { mutableIntStateOf(0) }
    var entries by remember { mutableStateOf<List<RemoteFileEntry>?>(null) }
    var listed by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<FileViewError?>(null) }
    LaunchedEffect(path, reload) {
        // Another folder starts blank; the same one keeps its entries on screen while it refreshes.
        if (listed != path) entries = null
        try {
            entries = source.list(path)
            listed = path
            error = null
        } catch (failure: FileViewException) {
            if (entries == null) error = failure.reason
        }
    }
    OnTurnEnd(active) { reload += 1 }
    val root = stringResource(Res.string.files_root)
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp).testTag("files.panel")) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (path.isNotEmpty()) {
                    IconButton(onClick = { path = FileNames.parent(path) }, modifier = Modifier.testTag("files.up")) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.back))
                    }
                }
                Text(
                    if (path.isEmpty()) stringResource(Res.string.files_title) else FileNames.title(path, root),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f).padding(horizontal = 12.dp, vertical = 8.dp),
                )
                IconButton(onClick = { reload += 1 }, modifier = Modifier.testTag("files.refresh")) {
                    Icon(Icons.Filled.Refresh, contentDescription = stringResource(Res.string.files_refresh))
                }
            }
            val shown = entries
            when {
                error != null -> Failure(error!!) { reload += 1 }
                shown == null -> Loading()
                shown.isEmpty() -> Message(stringResource(Res.string.files_empty))
                else ->
                    LazyColumn(Modifier.fillMaxWidth().heightIn(max = 480.dp)) {
                        items(shown, key = { it.path }) { entry ->
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .clickable { if (entry.isDirectory) path = entry.path else onOpenFile(entry.path) }
                                    .padding(horizontal = 20.dp, vertical = 12.dp)
                                    .testTag("files.entry.${entry.path}"),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(14.dp),
                            ) {
                                Icon(
                                    if (entry.isDirectory) Icons.Filled.Folder else FileNames.category(entry.name).icon(),
                                    contentDescription = null,
                                    tint = if (entry.isDirectory) MaterialTheme.colorScheme.primary else MaterialTheme.vettaExtra.secondaryText,
                                )
                                Column(Modifier.weight(1f)) {
                                    Text(entry.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
                                    val time = relativeTimeLabel(entry.modifiedAt.toLong())
                                    Text(
                                        if (entry.isDirectory) time else "${sizeLabel(entry.size)} · $time",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.vettaExtra.secondaryText,
                                    )
                                }
                            }
                        }
                    }
            }
        }
    }
}

/** Runs `onEnd` each time the agent's turn ends: `active` going from true to false. */
@Composable
internal fun OnTurnEnd(active: Boolean, onEnd: () -> Unit) {
    var was by remember { mutableStateOf(active) }
    LaunchedEffect(active) {
        if (was && !active) onEnd()
        was = active
    }
}

@Composable
internal fun Loading() {
    Row(Modifier.fillMaxWidth().padding(vertical = 32.dp), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
        Text(stringResource(Res.string.files_loading), color = MaterialTheme.vettaExtra.secondaryText)
    }
}

@Composable
private fun Message(text: String) {
    Text(text, color = MaterialTheme.vettaExtra.secondaryText, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp).testTag("files.message"))
}

/** Why a file or folder cannot be shown, with a way to try again when that may help. */
@Composable
internal fun Failure(error: FileViewError, onRetry: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(error.icon(), contentDescription = null, modifier = Modifier.size(36.dp), tint = MaterialTheme.vettaExtra.secondaryText)
        Text(error.message(), color = MaterialTheme.vettaExtra.secondaryText, textAlign = TextAlign.Center, modifier = Modifier.testTag("files.message"))
        if (error.retryable) TextButton(onClick = onRetry, modifier = Modifier.testTag("files.retry")) { Text(stringResource(Res.string.files_retry)) }
    }
}

private fun FileViewError.icon(): ImageVector =
    when (this) {
        FileViewError.Forbidden -> Icons.Outlined.Lock
        FileViewError.NotFound -> Icons.Outlined.SearchOff
        FileViewError.TooLarge -> Icons.Outlined.Storage
        FileViewError.Offline -> Icons.Outlined.CloudOff
        FileViewError.UnsupportedDesktop -> Icons.Outlined.SystemUpdate
        FileViewError.NotAFile, FileViewError.Failed -> Icons.Outlined.ErrorOutline
    }

internal fun FileCategory.icon(): ImageVector =
    when (this) {
        FileCategory.Text -> Icons.AutoMirrored.Outlined.Article
        FileCategory.Web -> Icons.Outlined.Language
        FileCategory.Image -> Icons.Outlined.Image
        FileCategory.Pdf -> Icons.Outlined.PictureAsPdf
        FileCategory.Sheet -> Icons.Outlined.TableChart
        FileCategory.Slides -> Icons.Outlined.Slideshow
        FileCategory.Document -> Icons.Outlined.Description
        FileCategory.Audio -> Icons.Outlined.AudioFile
        FileCategory.Video -> Icons.Outlined.Movie
        FileCategory.Archive -> Icons.Outlined.FolderZip
        FileCategory.Code -> Icons.Outlined.Code
    }

@Composable
internal fun FileViewError.message(): String =
    stringResource(
        when (this) {
            FileViewError.UnsupportedDesktop -> Res.string.files_error_unsupported_desktop
            FileViewError.Offline -> Res.string.files_error_offline
            FileViewError.Forbidden -> Res.string.files_error_forbidden
            FileViewError.NotFound -> Res.string.files_error_not_found
            FileViewError.TooLarge -> Res.string.files_error_too_large
            FileViewError.NotAFile -> Res.string.files_error_not_a_file
            FileViewError.Failed -> Res.string.files_error_failed
        },
    )

internal fun sizeLabel(bytes: Long): String =
    when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> "${(bytes + 512) / 1024} KB"
        else -> "${"%.1f".format(bytes / 1024.0 / 1024.0)} MB"
    }
