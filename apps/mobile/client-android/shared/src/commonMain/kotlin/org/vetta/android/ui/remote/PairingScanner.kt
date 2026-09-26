package org.vetta.android.ui.remote

import androidx.compose.runtime.Composable

/**
 * The camera QR scanner for pairing: returns what opens it, asking for the camera first
 * if need be. It covers the screen while open and hands back the first code it reads.
 */
@Composable
expect fun rememberPairingScanner(onScanned: (String) -> Unit): () -> Unit
