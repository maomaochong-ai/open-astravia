package org.vetta.android.ui.design.form

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.unit.dp
import org.vetta.android.ui.theme.vettaExtra
import org.vetta.android.ui.work.workColors

/**
 * A continuous value, SwiftUI's `Slider`. The track is the same groove as a segmented
 * picker; the filled part and the page stay different colors. The thumb is a small
 * white knob, not Material's large handle.
 */
@Composable
fun Slider(
    value: Float,
    onValueChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
    valueRange: ClosedFloatingPointRange<Float> = 0f..1f,
    onValueChangeFinished: (() -> Unit)? = null,
) {
    val span = (valueRange.endInclusive - valueRange.start).takeIf { it > 0f } ?: 1f
    val fraction = ((value - valueRange.start) / span).coerceIn(0f, 1f)
    val onChange by rememberUpdatedState(onValueChange)
    val onFinished by rememberUpdatedState(onValueChangeFinished)
    val active = MaterialTheme.workColors.pill
    val thumb = if (formDark()) MaterialTheme.workColors.pill else Color.White
    val border = MaterialTheme.vettaExtra.border
    BoxWithConstraints(
        modifier
            .fillMaxWidth()
            .heightIn(min = FormMetrics.MinRowHeight)
            .padding(horizontal = FormMetrics.RowPadding)
            .semantics {
                progressBarRangeInfo = ProgressBarRangeInfo(value, valueRange)
                setProgress { next ->
                    onValueChange(next.coerceIn(valueRange.start, valueRange.endInclusive))
                    true
                }
            }
            .pointerInput(valueRange) {
                val thumbPx = 22.dp.toPx()
                val travel = (size.width - thumbPx).coerceAtLeast(1f)
                fun update(x: Float) {
                    val next = ((x - thumbPx / 2f) / travel).coerceIn(0f, 1f)
                    onChange(valueRange.start + next * span)
                }
                awaitEachGesture {
                    val down = awaitFirstDown()
                    update(down.position.x)
                    drag(down.id) { change ->
                        update(change.position.x)
                        change.consume()
                    }
                    onFinished?.invoke()
                }
            },
        contentAlignment = Alignment.CenterStart,
    ) {
        val travel = maxWidth - 22.dp
        val x = with(LocalDensity.current) { (travel * fraction).coerceAtLeast(0.dp) }
        val groove = grooveColor()
        Canvas(Modifier.fillMaxWidth().align(Alignment.Center)) {
            val thumbPx = 22.dp.toPx()
            val left = thumbPx / 2f
            val right = size.width - left
            val head = left + (right - left) * fraction
            val radius = CornerRadius(size.height / 2f)
            val top = size.height / 2f - 2.dp.toPx()
            val bar = 4.dp.toPx()
            drawRoundRect(groove, topLeft = Offset(left, top), size = Size(right - left, bar), cornerRadius = radius)
            drawRoundRect(active, topLeft = Offset(left, top), size = Size((head - left).coerceAtLeast(0f), bar), cornerRadius = radius)
        }
        Box(
            Modifier
                .offset(x = x)
                .size(22.dp)
                .shadow(if (formDark()) 0.dp else 2.dp, CircleShape, ambientColor = Color.Black.copy(alpha = 0.08f), spotColor = Color.Black.copy(alpha = 0.16f))
                .clip(CircleShape)
                .background(thumb)
                .border(0.5.dp, border, CircleShape),
        )
    }
}

@Composable
fun SectionScope.slider(
    value: Float,
    onValueChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
    valueRange: ClosedFloatingPointRange<Float> = 0f..1f,
    onValueChangeFinished: (() -> Unit)? = null,
) {
    Slider(value, onValueChange, modifier.layoutId(FormMetrics.RowPadding), valueRange, onValueChangeFinished)
}
