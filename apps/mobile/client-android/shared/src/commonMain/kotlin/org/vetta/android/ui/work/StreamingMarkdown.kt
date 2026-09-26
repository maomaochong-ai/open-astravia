package org.vetta.android.ui.work

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import kotlinx.coroutines.flow.first
import org.vetta.android.domain.work.StreamReveal
import org.vetta.android.ui.chat.MarkdownContent

/**
 * A reply's text as it streams in: deltas arrive from the desktop in bursts, so it is
 * played out at an even pace (see [StreamReveal]) that speeds up to catch up with a
 * large burst, instead of jumping a block at a time. Frames are drawn only while there
 * is text left to show. Text already there when the chat opened is shown at once, apart
 * from the last few characters of a reply still on its way.
 */
@Composable
fun StreamingMarkdown(text: String, streaming: Boolean) {
    var shown by remember { mutableIntStateOf(if (streaming) (text.length - LEAD_IN).coerceAtLeast(0) else text.length) }
    val latest by rememberUpdatedState(text.length)
    LaunchedEffect(Unit) {
        while (true) {
            // Asleep until there is something left to show.
            snapshotFlow { latest }.first { it != shown }
            // A fresh reveal each time it wakes, so the idle gap is not spent all at once.
            var reveal: StreamReveal? = null
            var origin = 0L
            do {
                val done =
                    withFrameNanos { now ->
                        val current = reveal ?: StreamReveal(shown, 0.0).also {
                            reveal = it
                            origin = now
                        }
                        current.advance((now - origin) / 1e9, latest)
                        shown = current.shown
                        !current.animating(latest)
                    }
            } while (!done)
        }
    }
    MarkdownContent(if (shown >= text.length) text else text.take(shown))
}

/** Characters of a reply still streaming that play out when the chat opens on it. */
private const val LEAD_IN = 24
