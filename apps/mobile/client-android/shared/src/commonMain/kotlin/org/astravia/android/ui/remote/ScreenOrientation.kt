package org.astravia.android.ui.remote

import androidx.compose.runtime.Composable

/** Turns the app to landscape while `landscape` holds and gives the orientation back after. */
@Composable
expect fun LandscapeWhile(landscape: Boolean)
