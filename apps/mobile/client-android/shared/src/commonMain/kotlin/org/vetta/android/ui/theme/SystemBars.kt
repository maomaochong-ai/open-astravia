package org.vetta.android.ui.theme

import androidx.compose.runtime.Composable

/**
 * Status and navigation bar icons dark on a light theme and light on a dark one, following
 * the app's theme rather than the system's, which may differ when a theme is picked in Settings.
 */
@Composable
expect fun SystemBarsAppearance(dark: Boolean)

/** Light bar icons while this is shown, over a page that is always dark; the theme's return after. */
@Composable
expect fun LightSystemBarIcons()
