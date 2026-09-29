package org.vetta.android.ui.work

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
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
