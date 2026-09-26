package org.vetta.android.ui.remote

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.LaptopChromebook
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.link.LinkIndicator
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.resources.Res
import org.vetta.android.resources.close
import org.vetta.android.resources.remote_control
import org.vetta.android.resources.remote_control_hint
import org.vetta.android.resources.remote_control_offline
import org.vetta.android.ui.design.GlassCircleButton
import org.vetta.android.ui.theme.LightSystemBarIcons
import org.vetta.android.ui.work.describe
import org.vetta.android.ui.work.linkDetail

/**
 * The paired computer's screen, full size on black: tapping clicks and dragging moves
 * the pointer on the desktop. The title names the computer and how the phone reaches it;
 * while the computer is offline the page says so instead of showing a stale picture.
 */
@Composable
fun RemoteDesktopScreen(state: MirrorState, viewerUrl: String?, onClose: () -> Unit) {
    val onBlack = Color.White
    LightSystemBarIcons()
    Column(Modifier.fillMaxSize().background(Color.Black).statusBarsPadding().navigationBarsPadding().testTag("remote")) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            GlassCircleButton(Icons.Filled.Close, stringResource(Res.string.close), onClick = onClose, size = 44.dp, tag = "remote.close")
            Column(Modifier.weight(1f)) {
                Text(
                    state.desktop?.desktopName ?: stringResource(Res.string.remote_control),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = onBlack,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.semantics { heading() },
                )
                val indicator = LinkIndicator.of(state.link)
                Text(
                    (if (indicator == LinkIndicator.Online) linkDetail(state.link) else null) ?: describe(indicator),
                    style = MaterialTheme.typography.bodySmall,
                    color = onBlack.copy(alpha = 0.6f),
                    maxLines = 1,
                )
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            if (viewerUrl != null && state.online) {
                RemoteDesktopSurface(target = viewerUrl, modifier = Modifier.fillMaxSize())
            } else {
                Column(Modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.Outlined.LaptopChromebook, contentDescription = null, tint = onBlack.copy(alpha = 0.5f), modifier = Modifier.size(48.dp))
                    Text(stringResource(Res.string.remote_control_offline), color = onBlack.copy(alpha = 0.7f), textAlign = TextAlign.Center)
                }
            }
        }
        Text(
            stringResource(Res.string.remote_control_hint),
            style = MaterialTheme.typography.bodySmall,
            color = onBlack.copy(alpha = 0.5f),
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(12.dp),
        )
    }
}
