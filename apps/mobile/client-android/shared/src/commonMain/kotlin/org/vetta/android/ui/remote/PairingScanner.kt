package org.vetta.android.ui.remote

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * The pairing viewfinder. While [active], this is the back camera (asking for access
 * the first time it is needed) and [onScanned] receives the first QR code it reads.
 * [onLive] is true only while that preview is actually on screen. When [active] is
 * false the camera stops and nothing is drawn, so the glass frame around it stays put.
 */
@Composable
expect fun PairingCameraPreview(
    active: Boolean,
    onScanned: (String) -> Unit,
    onLive: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
)
