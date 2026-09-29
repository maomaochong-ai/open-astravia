package org.vetta.android.ui.work

import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AudioFile
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import org.vetta.android.ui.theme.vettaExtra
import java.io.File

@Composable
actual fun MediaPreview(name: String, data: ByteArray, audio: Boolean, modifier: Modifier, onUnplayable: () -> Unit) {
    val context = LocalContext.current
    val unplayable by rememberUpdatedState(onUnplayable)
    // The system player reads from a file, not from memory.
    val file by produceState<Result<File>?>(null, data) { value = runCatching { PreviewFiles.write(context, name, "", data) } }
    val written = file ?: return Loading()
    val path = written.getOrNull()
    if (path == null) {
        LaunchedEffect(written) { unplayable() }
        return
    }
    val player =
        @Composable { playerModifier: Modifier ->
            AndroidView(
                modifier = playerModifier.testTag("files.media"),
                factory = { viewContext ->
                    VideoView(viewContext).apply {
                        val controls = MediaController(viewContext)
                        controls.setAnchorView(this)
                        setMediaController(controls)
                        // Paused on its first frame with the controls up; the reader presses play.
                        setOnPreparedListener {
                            seekTo(1)
                            controls.show(0)
                        }
                        // Not the system's own error dialog: the preview offers other apps instead.
                        setOnErrorListener { _, _, _ ->
                            unplayable()
                            true
                        }
                        setVideoPath(path.path)
                    }
                },
                onRelease = VideoView::stopPlayback,
            )
        }
    if (audio) {
        Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically)) {
            Icon(Icons.Outlined.AudioFile, contentDescription = null, modifier = Modifier.size(72.dp), tint = MaterialTheme.vettaExtra.secondaryText)
            Text(name, style = MaterialTheme.typography.titleMedium)
            // The player itself has nothing to show for sound; it is here for its controls.
            player(Modifier.fillMaxWidth().height(1.dp))
        }
    } else {
        Box(modifier, contentAlignment = Alignment.Center) { player(Modifier.fillMaxSize()) }
    }
}
