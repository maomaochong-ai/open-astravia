package org.vetta.android.ui.remote

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

@Composable
expect fun RemoteDesktopSurface(target: String, modifier: Modifier = Modifier)
