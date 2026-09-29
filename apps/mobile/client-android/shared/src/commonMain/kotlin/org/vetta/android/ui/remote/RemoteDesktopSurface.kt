package org.vetta.android.ui.remote

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import org.vetta.android.domain.remote.RemoteScreenCursor

/**
 * The paired desktop's screen with the whole page as its trackpad (ADR-0140): one
 * finger moves the pointer from where it is, anywhere on the page; a tap clicks and a
 * two-finger tap right-clicks where the pointer is; holding half a second presses the
 * button, so moving then drags. Two fingers pinch to zoom the picture, move it once
 * zoomed, and scroll the desktop otherwise. The phone draws the pointer, in `cursor`'s
 * shape when the desktop reports one. While `keyboardOpen` the phone's keyboard types
 * on the desktop; `onKeyboardClosed` runs when it is put away.
 */
@Composable
expect fun RemoteDesktopSurface(
    target: String,
    modifier: Modifier = Modifier,
    keyboardOpen: Boolean = false,
    onKeyboardClosed: () -> Unit = {},
    cursor: RemoteScreenCursor? = null,
)
