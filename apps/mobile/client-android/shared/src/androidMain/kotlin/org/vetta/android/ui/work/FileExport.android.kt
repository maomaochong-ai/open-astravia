package org.vetta.android.ui.work

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.vetta.android.domain.work.FileNames
import java.io.File
import java.util.UUID

@Composable
actual fun rememberFileExport(): FileExport {
    val context = LocalContext.current
    return remember(context) { AndroidFileExport(context) }
}

private class AndroidFileExport(private val context: Context) : FileExport {
    override suspend fun share(name: String, mimeType: String, data: ByteArray) {
        val (uri, type) = PreviewFiles.shared(context, name, mimeType, data)
        val send =
            Intent(Intent.ACTION_SEND)
                .setType(type)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri(name, uri)
        // Vetta takes shares to start a session; offering it here would only loop back.
        val own =
            context.packageManager.queryIntentActivities(send, 0)
                .filter { it.activityInfo.packageName == context.packageName }
                .map { ComponentName(it.activityInfo.packageName, it.activityInfo.name) }
        val chooser = Intent.createChooser(send, null).putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, own.toTypedArray())
        context.startActivity(chooser)
    }

    override suspend fun open(name: String, mimeType: String, data: ByteArray): Boolean {
        val (uri, type) = PreviewFiles.shared(context, name, mimeType, data)
        val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return try {
            context.startActivity(view)
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }
}

/**
 * Fetched desktop files written to the cache, for other apps and for the system views
 * that read from a file (PDF, media). Each goes in a folder of its own under its own
 * name; anything a day old is swept when the next one is written.
 */
internal object PreviewFiles {
    private const val FOLDER = "files"
    private const val KEEP_MS = 24 * 60 * 60 * 1000L

    suspend fun write(context: Context, name: String, mimeType: String, data: ByteArray): File =
        withContext(Dispatchers.IO) {
            val root = File(context.cacheDir, FOLDER)
            val now = System.currentTimeMillis()
            root.listFiles()?.filter { now - it.lastModified() > KEEP_MS }?.forEach { it.deleteRecursively() }
            val folder = File(root, UUID.randomUUID().toString()).apply { mkdirs() }
            File(folder, FileNames.exportName(name, mimeType)).apply { writeBytes(data) }
        }

    /** A copy other apps may read, and the type to offer it as. */
    suspend fun shared(context: Context, name: String, mimeType: String, data: ByteArray): Pair<Uri, String> {
        val file = write(context, name, mimeType, data)
        val uri = FileProvider.getUriForFile(context, AttachmentReader.authority(context), file)
        return uri to typeOf(file.name, mimeType)
    }

    /** The desktop names a type by extension from a short list; the phone's list knows Office and the rest. */
    private fun typeOf(name: String, sent: String): String =
        MimeTypeMap.getSingleton().getMimeTypeFromExtension(FileNames.extensionOf(name))
            ?: sent.takeUnless { it == "application/octet-stream" }
            ?: "application/octet-stream"
}
