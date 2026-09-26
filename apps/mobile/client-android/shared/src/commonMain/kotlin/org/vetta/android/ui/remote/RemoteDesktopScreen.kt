package org.vetta.android.ui.remote

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Keyboard
import androidx.compose.material.icons.outlined.LaptopChromebook
import androidx.compose.material.icons.outlined.ScreenRotation
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
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
import org.vetta.android.resources.remote_keyboard
import org.vetta.android.resources.remote_keyboard_hint
import org.vetta.android.resources.remote_rotate
import org.vetta.android.ui.design.GlassCircleButton
import org.vetta.android.ui.theme.LightSystemBarIcons
import org.vetta.android.ui.work.describe
import org.vetta.android.ui.work.linkDetail

/**
 * The paired computer's screen, full size on black, used as the desktop's mouse (see
 * [RemoteDesktopSurface]); the controls bring up the keyboard to type on the desktop and
 * turn the phone to landscape for a larger picture. The title names the computer and how
 * the phone reaches it; while the computer is offline the page says so instead of showing
 * a stale picture. In landscape the controls move to the sides so the picture keeps the
 * full height.
 */
@Composable
fun RemoteDesktopScreen(state: MirrorState, viewerUrl: String?, onClose: () -> Unit) {
    var keyboardOpen by remember { mutableStateOf(false) }
    // Kept across the rotation it causes, which rebuilds the activity.
    var landscape by rememberSaveable { mutableStateOf(false) }
    LightSystemBarIcons()
    LandscapeWhile(landscape)
    val live = viewerUrl != null && state.online
    val close = @Composable { GlassCircleButton(Icons.Filled.Close, stringResource(Res.string.close), onClick = onClose, size = 44.dp, tag = "remote.close") }
    val keyboard =
        @Composable {
            GlassCircleButton(
                Icons.Outlined.Keyboard,
                stringResource(Res.string.remote_keyboard),
                onClick = { keyboardOpen = !keyboardOpen },
                size = 44.dp,
                enabled = live,
                tag = "remote.keyboard",
            )
        }
    val rotate =
        @Composable {
            GlassCircleButton(
                Icons.Outlined.ScreenRotation,
                stringResource(Res.string.remote_rotate),
                onClick = { landscape = !landscape },
                size = 44.dp,
                tag = "remote.rotate",
            )
        }
    val picture =
        @Composable { modifier: Modifier ->
            Box(modifier, contentAlignment = Alignment.Center) {
                if (live && viewerUrl != null) {
                    RemoteDesktopSurface(
                        target = viewerUrl,
                        modifier = Modifier.fillMaxSize(),
                        keyboardOpen = keyboardOpen,
                        onKeyboardClosed = { keyboardOpen = false },
                    )
                } else {
                    Column(Modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(Icons.Outlined.LaptopChromebook, contentDescription = null, tint = OnBlack.copy(alpha = 0.5f), modifier = Modifier.size(48.dp))
                        Text(stringResource(Res.string.remote_control_offline), color = OnBlack.copy(alpha = 0.7f), textAlign = TextAlign.Center)
                    }
                }
            }
        }
    BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black).safeDrawingPadding().testTag("remote")) {
        if (maxWidth > maxHeight) {
            Row(Modifier.fillMaxSize()) {
                Column(Modifier.fillMaxHeight().padding(8.dp), verticalArrangement = Arrangement.SpaceBetween) {
                    close()
                    keyboard()
                }
                picture(Modifier.weight(1f).fillMaxHeight())
                Column(Modifier.fillMaxHeight().padding(8.dp), verticalArrangement = Arrangement.Bottom) { rotate() }
            }
        } else {
            Column(Modifier.fillMaxSize()) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    close()
                    Title(state, Modifier.weight(1f))
                }
                picture(Modifier.weight(1f).fillMaxWidth())
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    keyboard()
                    Text(
                        stringResource(if (keyboardOpen) Res.string.remote_keyboard_hint else Res.string.remote_control_hint),
                        style = MaterialTheme.typography.bodySmall,
                        color = OnBlack.copy(alpha = 0.5f),
                        textAlign = TextAlign.Center,
                        modifier = Modifier.weight(1f),
                    )
                    rotate()
                }
            }
        }
    }
}

/** The computer's name, and how the phone reaches it. */
@Composable
private fun Title(state: MirrorState, modifier: Modifier) {
    Column(modifier) {
        Text(
            state.desktop?.desktopName ?: stringResource(Res.string.remote_control),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            color = OnBlack,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.semantics { heading() },
        )
        val indicator = LinkIndicator.of(state.link)
        Text(
            (if (indicator == LinkIndicator.Online) linkDetail(state.link) else null) ?: describe(indicator),
            style = MaterialTheme.typography.bodySmall,
            color = OnBlack.copy(alpha = 0.6f),
            maxLines = 1,
        )
    }
}

private val OnBlack = Color.White
