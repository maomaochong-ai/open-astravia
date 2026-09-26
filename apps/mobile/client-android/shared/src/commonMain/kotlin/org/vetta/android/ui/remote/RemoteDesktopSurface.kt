package org.vetta.android.ui.remote

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * The paired desktop's screen, and touches on it as the desktop's mouse: a tap clicks, a
 * long press right-clicks, a drag drags; two fingers pinch to zoom the picture on the
 * phone, pan it once zoomed, and scroll the desktop otherwise. While `keyboardOpen` the
 * phone's keyboard types on the desktop; `onKeyboardClosed` runs when it is put away.
 */
@Composable
expect fun RemoteDesktopSurface(
    target: String,
    modifier: Modifier = Modifier,
    keyboardOpen: Boolean = false,
    onKeyboardClosed: () -> Unit = {},
)
