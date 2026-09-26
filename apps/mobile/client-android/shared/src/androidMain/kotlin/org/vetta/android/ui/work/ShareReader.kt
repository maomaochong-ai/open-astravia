package org.vetta.android.ui.work

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.vetta.android.domain.work.IncomingShare

/** Whether an intent is another app sharing something into Vetta. */
fun isShareIntent(intent: Intent): Boolean = intent.action == Intent.ACTION_SEND || intent.action == Intent.ACTION_SEND_MULTIPLE

/**
 * Reads a share into what New Session can hold: the text, and every stream as an
 * attachment fitted to one upload (pictures shrunk as when picked in the app). Runs off
 * the main thread; null when the intent is not a share.
 */
suspend fun readShare(context: Context, intent: Intent): IncomingShare? {
    if (!isShareIntent(intent)) return null
    val text =
        listOfNotNull(
            intent.getStringExtra(Intent.EXTRA_SUBJECT)?.takeIf { it.isNotBlank() },
            intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.takeIf { it.isNotBlank() },
        ).distinct().joinToString("\n")
    val uris = streams(intent)
    return withContext(Dispatchers.IO) {
        var skipped = 0
        val attachments =
            uris.flatMap { uri ->
                when (val pick = runCatching { AttachmentReader.read(context, uri) }.getOrNull()) {
                    is AttachmentPick.Picked -> pick.attachments
                    else -> {
                        skipped += 1
                        emptyList()
                    }
                }
            }
        IncomingShare(text, attachments, skipped)
    }
}

private fun streams(intent: Intent): List<Uri> =
    when (intent.action) {
        Intent.ACTION_SEND ->
            listOfNotNull(
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(Intent.EXTRA_STREAM)
                },
            )
        Intent.ACTION_SEND_MULTIPLE ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
            }
        else -> emptyList()
    }
