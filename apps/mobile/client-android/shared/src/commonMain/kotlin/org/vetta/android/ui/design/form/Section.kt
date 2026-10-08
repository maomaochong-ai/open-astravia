package org.vetta.android.ui.design.form

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.vetta.android.ui.design.springContentSize
import org.vetta.android.ui.theme.vettaExtra

/**
 * One rounded card of rows, SwiftUI's inset-grouped `Section`.
 *
 * Children are the form controls (`button`, `toggle`, `picker`, and the rest). The card
 * inserts the hairline between them, and its height eases open and shut when rows appear
 * or leave. [header] and [footer] are the footnote above and below. A title that belongs
 * inside the card, with its note directly underneath, is [SectionScope.heading].
 */
@Composable
fun Section(
    modifier: Modifier = Modifier,
    header: String? = null,
    footer: String? = null,
    content: @Composable SectionScope.() -> Unit,
) {
    val shape = RoundedCornerShape(FormMetrics.Corner)
    val footnote = MaterialTheme.colorScheme.onSurfaceVariant
    val fill = MaterialTheme.colorScheme.surface
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (header != null) {
            Text(
                header,
                style = MaterialTheme.typography.bodySmall,
                color = footnote,
                modifier = Modifier.padding(horizontal = FormMetrics.RowPadding),
            )
        }
        SectionStack(
            Modifier
                .fillMaxWidth()
                .springContentSize()
                .clip(shape)
                .background(fill)
                .border(0.75.dp, MaterialTheme.vettaExtra.border, shape),
        ) {
            SectionScope.content()
        }
        if (footer != null) {
            Text(
                footer,
                style = MaterialTheme.typography.bodySmall,
                color = footnote,
                modifier = Modifier.padding(horizontal = FormMetrics.RowPadding),
            )
        }
    }
}

/** Receiver for the rows of a [Section]. Each control file adds its own row to this scope. */
object SectionScope

/**
 * A title inside the card, with [caption] directly under it. The hairline before the
 * next row separates this band from the controls. Darker and larger than the footnote
 * [Section] draws outside the card.
 */
@Composable
fun SectionScope.heading(title: String, caption: String? = null) {
    Column(
        Modifier
            .layoutId(FormMetrics.RowPadding)
            .fillMaxWidth()
            .padding(horizontal = FormMetrics.RowPadding, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(title, style = formLabelStyle().copy(fontWeight = FontWeight.Medium), color = MaterialTheme.colorScheme.onSurface)
        if (caption != null) {
            Text(caption, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** A region the card does not know how to draw. Children stack downward. One separator sits above the whole region. */
@Composable
fun SectionScope.custom(dividerInset: Dp = FormMetrics.RowPadding, content: @Composable () -> Unit) {
    Column(Modifier.layoutId(dividerInset).fillMaxWidth()) { content() }
}

private data class DividerMark(val centerY: Float, val insetPx: Float)

/**
 * Separators are measured with the children, not counted during composition: a skipped
 * row would otherwise drop the hairline on the next one. Each child reports its inset
 * through [layoutId].
 */
@Composable
private fun SectionStack(modifier: Modifier, content: @Composable () -> Unit) {
    val border = MaterialTheme.vettaExtra.border
    val marks = remember { mutableListOf<DividerMark>() }
    Layout(
        content = content,
        modifier =
            modifier.drawWithContent {
                drawContent()
                val stroke = 0.5.dp.toPx()
                for (mark in marks) {
                    drawLine(border, Offset(mark.insetPx, mark.centerY), Offset(size.width, mark.centerY), strokeWidth = stroke)
                }
            },
    ) { measurables, constraints ->
        val width = if (constraints.hasBoundedWidth) constraints.maxWidth else constraints.minWidth
        val hairline = 0.5.dp.roundToPx().coerceAtLeast(1)
        val childConstraints = constraints.copy(minWidth = width, maxWidth = width, minHeight = 0)
        val placeables = measurables.map { it.measure(childConstraints) }
        val gapCount = (placeables.size - 1).coerceAtLeast(0)
        val height = placeables.sumOf { it.height } + hairline * gapCount
        val next = ArrayList<DividerMark>(gapCount)
        var cursor = 0
        placeables.forEachIndexed { index, placeable ->
            if (index > 0) {
                val inset = ((measurables[index].layoutId as? Dp) ?: FormMetrics.RowPadding).toPx()
                next.add(DividerMark(cursor + hairline / 2f, inset))
                cursor += hairline
            }
            cursor += placeable.height
        }
        layout(width, height) {
            marks.clear()
            marks.addAll(next)
            var y = 0
            placeables.forEachIndexed { index, placeable ->
                if (index > 0) y += hairline
                placeable.placeRelative(0, y)
                y += placeable.height
            }
        }
    }
}
