package org.vetta.android.ui.design.form

import androidx.compose.ui.unit.dp

/**
 * Shared measures for an inset grouped form, the list iOS Settings uses.
 * Rows are 44dp. Every hairline in one card starts at the same leading padding.
 */
object FormMetrics {
    val RowPadding = 16.dp
    val IconSize = 22.dp
    val IconGap = 12.dp
    val MinRowHeight = 44.dp
    val Corner = 22.dp
    val SectionGap = 22.dp

    /** Material's switch is a 52×32 control. This scale keeps the same drawing, smaller. */
    const val SwitchScale = 0.7f
}
