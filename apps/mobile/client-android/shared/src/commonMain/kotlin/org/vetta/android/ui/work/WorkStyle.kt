package org.vetta.android.ui.work

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance

/** The status colours the iPhone app uses, per light and dark, on Vetta's black-and-white base. */
@Immutable
data class WorkColors(
    val green: Color,
    val blue: Color,
    val yellow: Color,
    val red: Color,
    val orange: Color,
    val faint: Color,
    /** Secondary surfaces: filter chips, folded work groups, attachment chips. */
    val card2: Color,
    /** Inverted surface for the user's own bubble and primary pills. */
    val pill: Color,
    val pillInk: Color,
    /** The glow New Session fades into at the bottom of the screen. */
    val dawn: Color,
    val dawnSide: Color,
)

private val Light =
    WorkColors(
        green = Color(0xFF16A34A),
        blue = Color(0xFF2563EB),
        yellow = Color(0xFFE0A100),
        red = Color(0xFFDC2626),
        orange = Color(0xFFD97706),
        faint = Color(0xFF9AA0A6),
        card2 = Color(0xFFF0F1F3),
        pill = Color(0xFF0B0C0E),
        pillInk = Color(0xFFFFFFFF),
        dawn = Color(0xFFD6E2FB),
        dawnSide = Color(0xFFE6DEFA),
    )

private val Dark =
    WorkColors(
        green = Color(0xFF22C55E),
        blue = Color(0xFF3B82F6),
        yellow = Color(0xFFFACC15),
        red = Color(0xFFF0524F),
        orange = Color(0xFFF59E0B),
        faint = Color(0xFF5B6067),
        card2 = Color(0xFF1C1F23),
        pill = Color(0xFFF4F5F6),
        pillInk = Color(0xFF0A0B0D),
        dawn = Color(0xFF13235E),
        dawnSide = Color(0xFF1C1A52),
    )

/** Follows the theme actually in use (which may differ from the system setting). */
val MaterialTheme.workColors: WorkColors
    @Composable
    get() = if (colorScheme.background.luminance() < 0.5f) Dark else Light
