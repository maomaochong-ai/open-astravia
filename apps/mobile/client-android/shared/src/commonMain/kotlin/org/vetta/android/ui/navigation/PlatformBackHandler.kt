package org.vetta.android.ui.navigation

import androidx.compose.runtime.Composable

/**
 * The system Back, followed as it happens: `onProgress` reports how far the back swipe
 * has travelled (0 to 1) so the screen can move under the finger, then either `onBack`
 * when it is let go or `onCancel` when it is taken back. A button press jumps straight to `onBack`.
 */
@Composable
expect fun PlatformBackHandler(
    enabled: Boolean,
    onProgress: (Float) -> Unit = {},
    onCancel: () -> Unit = {},
    onBack: () -> Unit,
)
