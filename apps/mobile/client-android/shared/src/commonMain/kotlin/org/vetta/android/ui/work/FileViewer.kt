package org.vetta.android.ui.work

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Folder
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.RemoteFileEntry
import org.vetta.android.domain.remote.RemoteFileInfo
import org.vetta.android.domain.work.FileContent
import org.vetta.android.domain.work.FileNames
import org.vetta.android.domain.work.FilePreviewKind
import org.vetta.android.domain.work.FileText
import org.vetta.android.domain.work.FileViewError
import org.vetta.android.domain.work.FileViewException
import org.vetta.android.resources.Res
import org.vetta.android.resources.back
import org.vetta.android.resources.close
import org.vetta.android.resources.files_empty
import org.vetta.android.resources.files_error_failed
import org.vetta.android.resources.files_error_forbidden
import org.vetta.android.resources.files_error_not_a_file
import org.vetta.android.resources.files_error_not_found
import org.vetta.android.resources.files_error_offline
import org.vetta.android.resources.files_error_too_large
import org.vetta.android.resources.files_error_unsupported_desktop
import org.vetta.android.resources.files_loading
import org.vetta.android.resources.files_preview_unsupported
import org.vetta.android.resources.files_retry
import org.vetta.android.resources.files_root
import org.vetta.android.resources.files_title
import org.vetta.android.ui.chat.MarkdownContent
import org.vetta.android.ui.media.imageBitmapFromBytes
import org.vetta.android.ui.theme.vettaExtra

/** What the file views need from the desktop, each throwing [FileViewException]. */
interface FileSource {
    suspend fun list(path: String): List<RemoteFileEntry>

    suspend fun stat(href: String): RemoteFileInfo

    suspend fun read(info: RemoteFileInfo): FileContent
}

/**
 * The session's working directory, read-only, as the desktop's files panel shows it
 * (ADR-0139): folders first, a way up, and a tap on a file previews it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilesPanel(source: FileSource, onOpenFile: (String) -> Unit, onDismiss: () -> Unit) {
    var path by remember { mutableStateOf("") }
    var reload by remember { mutableIntStateOf(0) }
    var entries by remember { mutableStateOf<List<RemoteFileEntry>?>(null) }
    var error by remember { mutableStateOf<FileViewError?>(null) }
    LaunchedEffect(path, reload) {
        entries = null
        error = null
        try {
            entries = source.list(path)
        } catch (failure: FileViewException) {
            error = failure.reason
        }
    }
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
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }
            val shown = entries
            when {
                error != null -> Message(error!!.message(), onRetry = { reload += 1 })
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
                                Icon(if (entry.isDirectory) Icons.Outlined.Folder else Icons.Outlined.Description, contentDescription = null)
                                Text(entry.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                if (!entry.isDirectory) {
                                    Text(sizeLabel(entry.size), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
                                }
                            }
                        }
                    }
            }
        }
    }
}

/**
 * One desktop file, full screen: fetched when it opens, then shown by its kind as
 * Markdown, a web page, text or a picture; anything else says it cannot be shown here.
 */
@Composable
fun FilePreviewScreen(source: FileSource, href: String, onDismiss: () -> Unit) {
    var reload by remember { mutableIntStateOf(0) }
    var info by remember { mutableStateOf<RemoteFileInfo?>(null) }
    var content by remember { mutableStateOf<FileContent?>(null) }
    var error by remember { mutableStateOf<FileViewError?>(null) }
    LaunchedEffect(href, reload) {
        content = null
        error = null
        try {
            val file = source.stat(href).also { info = it }
            content = source.read(file)
        } catch (failure: FileViewException) {
            error = failure.reason
        }
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(MaterialTheme.vettaExtra.pageBackground).statusBarsPadding().navigationBarsPadding().testTag("files.preview")) {
            Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onDismiss, modifier = Modifier.testTag("files.preview.close")) {
                    Icon(Icons.Filled.Close, contentDescription = stringResource(Res.string.close))
                }
                Column(Modifier.weight(1f)) {
                    Text(info?.name ?: href.substringAfterLast('/'), style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    info?.let { Text(it.displayPath, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText, maxLines = 1, overflow = TextOverflow.StartEllipsis) }
                }
            }
            Box(Modifier.fillMaxSize()) {
                val file = info
                val data = content
                when {
                    error != null -> Message(error!!.message(), onRetry = { reload += 1 })
                    file == null || data == null -> Loading()
                    else -> FileBody(file, data)
                }
            }
        }
    }
}

@Composable
private fun FileBody(info: RemoteFileInfo, content: FileContent) {
    val kind = remember(content) { FilePreviewKind.of(info.name, content.mimeType, content.data) }
    val text = remember(content, kind) { if (kind == FilePreviewKind.Image || kind == FilePreviewKind.Unsupported) null else FileText.decode(content.data) }
    when (kind) {
        FilePreviewKind.Markdown ->
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) { MarkdownContent(text.orEmpty()) }
        FilePreviewKind.Html -> HtmlPreview(text.orEmpty(), Modifier.fillMaxSize())
        FilePreviewKind.Text ->
            SelectionContainer {
                Text(
                    text.orEmpty(),
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()).padding(16.dp).testTag("files.text"),
                )
            }
        FilePreviewKind.Image -> {
            val bitmap = remember(content) { imageBitmapFromBytes(content.data) }
            if (bitmap != null) {
                Image(bitmap, contentDescription = info.name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize().padding(8.dp))
            } else {
                Message(stringResource(Res.string.files_preview_unsupported))
            }
        }
        FilePreviewKind.Unsupported -> Message(stringResource(Res.string.files_preview_unsupported))
    }
}

/** A web page from the desktop, shown without running its scripts or loading anything from the network. */
@Composable
expect fun HtmlPreview(html: String, modifier: Modifier = Modifier)

@Composable
private fun Loading() {
    Row(Modifier.fillMaxWidth().padding(vertical = 32.dp), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
        Text(stringResource(Res.string.files_loading), color = MaterialTheme.vettaExtra.secondaryText)
    }
}

@Composable
private fun Message(text: String, onRetry: (() -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(text, color = MaterialTheme.vettaExtra.secondaryText, modifier = Modifier.testTag("files.message"))
        if (onRetry != null) TextButton(onClick = onRetry) { Text(stringResource(Res.string.files_retry)) }
    }
}

@Composable
private fun FileViewError.message(): String =
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

private fun sizeLabel(bytes: Long): String =
    when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> "${(bytes + 512) / 1024} KB"
        else -> "${"%.1f".format(bytes / 1024.0 / 1024.0)} MB"
    }
