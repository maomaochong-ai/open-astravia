package org.vetta.android.ui.work

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material3.Button
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.TextButton
import androidx.compose.runtime.produceState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.text.style.TextAlign
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.vetta.android.domain.work.documents.DocumentLabels
import org.vetta.android.domain.work.documents.DocumentPreview
import org.vetta.android.resources.files_no_app
import org.vetta.android.resources.files_open_with
import org.vetta.android.resources.files_rows_shown
import org.vetta.android.resources.files_share
import org.vetta.android.resources.files_sheet_empty
import org.vetta.android.resources.files_updated
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.RemoteFileInfo
import org.vetta.android.domain.work.FileContent
import org.vetta.android.domain.work.FileNames
import org.vetta.android.domain.work.FilePreviewKind
import org.vetta.android.domain.work.FileText
import org.vetta.android.domain.work.FileViewError
import org.vetta.android.domain.work.FileViewException
import org.vetta.android.resources.Res
import org.vetta.android.resources.close
import org.vetta.android.resources.files_preview_unsupported
import org.vetta.android.ui.chat.MarkdownContent
import org.vetta.android.ui.media.imageBitmapFromBytes
import org.vetta.android.ui.theme.vettaExtra

/** Hands a fetched file to other apps: the share sheet, or whichever app opens its type. */
interface FileExport {
    suspend fun share(name: String, mimeType: String, data: ByteArray)

    /** False when no app on the phone opens this type. */
    suspend fun open(name: String, mimeType: String, data: ByteArray): Boolean
}

@Composable
expect fun rememberFileExport(): FileExport

/**
 * One desktop file, full screen: fetched when it opens, then shown by its kind as
 * Markdown, a web page, text or a picture; anything else says it cannot be shown here
 * and offers it to other apps, which the top bar does for every file.
 */
@Composable
fun FilePreviewScreen(
    source: FileSource,
    href: String,
    onDismiss: () -> Unit,
    active: Boolean = false,
    export: FileExport = rememberFileExport(),
) {
    var reload by remember { mutableIntStateOf(0) }
    var info by remember { mutableStateOf<RemoteFileInfo?>(null) }
    var content by remember { mutableStateOf<FileContent?>(null) }
    var error by remember { mutableStateOf<FileViewError?>(null) }
    // The desktop's copy changed after this one was fetched.
    var changed by remember { mutableStateOf(false) }
    LaunchedEffect(href, reload) {
        content = null
        error = null
        changed = false
        try {
            val file = source.stat(href).also { info = it }
            content = source.read(file)
        } catch (failure: FileViewException) {
            error = failure.reason
        }
    }
    val scope = rememberCoroutineScope()
    // Only noticed when the agent's turn ends, not reloaded: a file does not change under the reader.
    OnTurnEnd(active) {
        val shown = info ?: return@OnTurnEnd
        scope.launch {
            val latest = runCatching { source.stat(shown.path) }.getOrNull() ?: return@launch
            changed = latest.modifiedAt != shown.modifiedAt || latest.size != shown.size
        }
    }
    val notices = remember { SnackbarHostState() }
    val noApp = stringResource(Res.string.files_no_app)
    val share: () -> Unit = {
        val file = info
        val data = content
        if (file != null && data != null) scope.launch { export.share(file.name, data.mimeType, data.data) }
    }
    val open: () -> Unit = {
        val file = info
        val data = content
        if (file != null && data != null) {
            scope.launch { if (!export.open(file.name, data.mimeType, data.data)) notices.showSnackbar(noApp) }
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
                if (content != null) {
                    IconButton(onClick = open, modifier = Modifier.testTag("files.preview.open")) {
                        Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = stringResource(Res.string.files_open_with))
                    }
                    IconButton(onClick = share, modifier = Modifier.testTag("files.preview.share")) {
                        Icon(Icons.Filled.Share, contentDescription = stringResource(Res.string.files_share))
                    }
                }
            }
            if (changed) {
                TextButton(
                    onClick = { reload += 1 },
                    modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.primary.copy(alpha = 0.1f)).testTag("files.preview.changed"),
                ) {
                    Icon(Icons.Filled.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                    Text(stringResource(Res.string.files_updated), modifier = Modifier.padding(start = 6.dp))
                }
            }
            Box(Modifier.fillMaxSize()) {
                val file = info
                val data = content
                when {
                    error != null -> Failure(error!!) { reload += 1 }
                    file == null || data == null -> Loading()
                    else -> FileBody(file, data, onOpen = open, onShare = share)
                }
                SnackbarHost(notices, Modifier.align(Alignment.BottomCenter))
            }
        }
    }
}

@Composable
private fun FileBody(info: RemoteFileInfo, content: FileContent, onOpen: () -> Unit, onShare: () -> Unit) {
    val kind = remember(content) { FilePreviewKind.of(info.name, content.mimeType, content.data) }
    val text = remember(content, kind) { if (kind in setOf(FilePreviewKind.Markdown, FilePreviewKind.Html, FilePreviewKind.Text)) FileText.decode(content.data) else null }
    when (kind) {
        FilePreviewKind.Markdown ->
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) { MarkdownContent(text.orEmpty()) }
        FilePreviewKind.Html -> HtmlPreview(text.orEmpty(), Modifier.fillMaxSize(), scripts = true)
        FilePreviewKind.Text -> {
            // Laid out a piece at a time, so a long log opens at once; lines wrap as on the iPhone.
            val pieces = remember(text) { FileText.chunks(text.orEmpty()) }
            val style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace)
            SelectionContainer {
                LazyColumn(Modifier.fillMaxSize().testTag("files.text"), contentPadding = PaddingValues(16.dp)) {
                    items(pieces) { piece -> Text(piece, style = style) }
                }
            }
        }
        FilePreviewKind.Image -> {
            // Decoded off the main thread; a picture that will not decode is handed on.
            val bitmap by produceState<Result<ImageBitmap?>?>(null, content) {
                value = Result.success(withContext(Dispatchers.Default) { imageBitmapFromBytes(content.data) })
            }
            when (val decoded = bitmap?.getOrNull()) {
                null -> if (bitmap == null) Loading() else CannotShow(info, content, onOpen, onShare)
                else -> {
                    val zoom = remember(content) { ZoomState() }
                    Box(Modifier.fillMaxSize().clipToBounds()) {
                        Image(
                            decoded,
                            contentDescription = info.name,
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.fillMaxSize().padding(8.dp).zoomable(zoom).testTag("files.image"),
                        )
                    }
                }
            }
        }
        FilePreviewKind.WebImage -> {
            val type = if (FileNames.extensionOf(info.name) == "svg" || content.mimeType == "image/svg+xml") "image/svg+xml" else content.mimeType
            val page = remember(content) { DocumentPreview.image(type, content.data) }
            HtmlPreview(page, Modifier.fillMaxSize(), zoomable = true)
        }
        FilePreviewKind.Pdf -> {
            var unreadable by remember(content) { mutableStateOf(false) }
            if (unreadable) CannotShow(info, content, onOpen, onShare) else PdfPreview(info.name, content.data, Modifier.fillMaxSize()) { unreadable = true }
        }
        FilePreviewKind.Audio, FilePreviewKind.Video -> {
            var unplayable by remember(content) { mutableStateOf(false) }
            if (unplayable) {
                CannotShow(info, content, onOpen, onShare)
            } else {
                MediaPreview(info.name, content.data, audio = kind == FilePreviewKind.Audio, modifier = Modifier.fillMaxSize()) { unplayable = true }
            }
        }
        FilePreviewKind.Document -> {
            val labels = documentLabels()
            // Drawn off the main thread: a large workbook takes a moment. "" when it could not be read.
            val page by produceState<String?>(null, content) {
                value = withContext(Dispatchers.Default) { DocumentPreview.html(info.name, content.data, labels) }.orEmpty()
            }
            when (val shown = page) {
                null -> Loading()
                "" -> CannotShow(info, content, onOpen, onShare)
                else -> HtmlPreview(shown, Modifier.fillMaxSize(), zoomable = true)
            }
        }
        FilePreviewKind.Unsupported -> CannotShow(info, content, onOpen, onShare)
    }
}

/** A file the phone cannot show itself, handed on to an app that can. */
@Composable
private fun CannotShow(info: RemoteFileInfo, content: FileContent, onOpen: () -> Unit, onShare: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) {
        Icon(Icons.Outlined.Description, contentDescription = null, modifier = Modifier.size(48.dp), tint = MaterialTheme.vettaExtra.secondaryText)
        Text(info.name, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Text(
            "${stringResource(Res.string.files_preview_unsupported)} · ${sizeLabel(content.data.size.toLong())}",
            color = MaterialTheme.vettaExtra.secondaryText,
            textAlign = TextAlign.Center,
            modifier = Modifier.testTag("files.message"),
        )
        Button(onClick = onOpen, modifier = Modifier.testTag("files.unsupported.open")) { Text(stringResource(Res.string.files_open_with)) }
        TextButton(onClick = onShare) { Text(stringResource(Res.string.files_share)) }
    }
}

/**
 * A PDF drawn page by page, pinched to zoom. `onUnreadable` when it will not open (a
 * password, a damaged file), for the caller to hand it on instead.
 */
@Composable
expect fun PdfPreview(name: String, data: ByteArray, modifier: Modifier = Modifier, onUnreadable: () -> Unit)

/** Sound or a video clip with the system's controls; `onUnplayable` when the phone cannot play it. */
@Composable
expect fun MediaPreview(name: String, data: ByteArray, audio: Boolean, modifier: Modifier = Modifier, onUnplayable: () -> Unit)

@Composable
private fun documentLabels(): DocumentLabels {
    val empty = stringResource(Res.string.files_sheet_empty)
    val rows = stringResource(Res.string.files_rows_shown)
    return remember(empty, rows) { DocumentLabels(empty) { shown, total -> rows.replace("%1\$d", "$shown").replace("%2\$d", "$total") } }
}

/**
 * A page from the desktop, or one [DocumentPreview] drew. Nothing is stored, the phone's
 * files are out of reach, and tapped links open in the browser. With `scripts` the page
 * runs its scripts and loads what it links to, as generated pages usually need (the
 * iPhone does the same); without, it is a static look that fetches nothing. A `zoomable`
 * page can be pinched, for documents laid out wider or smaller than the phone.
 */
@Composable
expect fun HtmlPreview(html: String, modifier: Modifier = Modifier, zoomable: Boolean = false, scripts: Boolean = false)
