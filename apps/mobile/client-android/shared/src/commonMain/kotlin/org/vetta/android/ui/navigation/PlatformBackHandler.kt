package org.vetta.android.ui.navigation

import androidx.compose.runtime.Composable

@Composable
expect fun PlatformBackHandler(
    enabled: Boolean,
    onBack: () -> Unit,
)

fun AppRoute.hasInAppBackDestination(): Boolean = this != AppRoute.Work
