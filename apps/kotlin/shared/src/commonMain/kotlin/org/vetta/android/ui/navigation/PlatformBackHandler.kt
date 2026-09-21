package org.vetta.android.ui.navigation

import androidx.compose.runtime.Composable

@Composable
expect fun PlatformBackHandler(
    enabled: Boolean,
    onBack: () -> Unit,
)

fun AppRoute.hasInAppBackDestination(): Boolean =
    when (this) {
        AppRoute.Boot,
        AppRoute.Welcome,
        is AppRoute.Main,
        -> false
        else -> true
    }
