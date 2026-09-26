package org.vetta.android.ui.shell

import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * True while Home stays beside the slot instead of sliding over it: on a tablet, or a
 * phone turned sideways. Nothing then opens or closes Home.
 */
val LocalHomeBeside = staticCompositionLocalOf { false }

/** The window width from which Home stays beside the slot (Material's expanded width). */
val HomeBesideMinWidth: Dp = 840.dp

/** How wide Home is when it stays beside the slot. */
val HomeBesideWidth: Dp = 380.dp
