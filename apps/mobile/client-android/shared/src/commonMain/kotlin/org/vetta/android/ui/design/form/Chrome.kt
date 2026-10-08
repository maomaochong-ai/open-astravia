package org.vetta.android.ui.design.form

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** 17pt regular, the body size of an iOS settings row. */
@Composable
internal fun formLabelStyle(): TextStyle =
    MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Normal, lineHeight = 22.sp)

internal fun Modifier.optionalTag(tag: String?): Modifier = if (tag != null) testTag(tag) else this

/**
 * The recessed fill of a segmented control, slider track or stepper.
 * Darker than the page, so on a white card it reads as a groove rather than a hole
 * through to the background.
 */
@Composable
internal fun grooveColor(): Color {
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    return if (dark) Color(0xFF2A2E34) else Color(0xFFDEE1E6)
}

/** The lifted choice inside a [grooveColor] track. White in light mode, a step lighter in dark. */
@Composable
internal fun grooveSelectionColor(): Color {
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    return if (dark) Color(0xFF454B53) else Color.White
}

@Composable
internal fun formDark(): Boolean = MaterialTheme.colorScheme.background.luminance() < 0.5f
