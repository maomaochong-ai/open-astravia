package org.vetta.android.ui.design.form

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.unit.dp
import org.vetta.android.ui.work.workColors

/**
 * A linear progress bar, SwiftUI's `ProgressView`.
 * [progress] is 0 to 1. Null means the work has no known end, and the bar slides.
 */
@Composable
fun ProgressView(
    modifier: Modifier = Modifier,
    progress: Float? = null,
    label: String? = null,
) {
    Column(
        modifier.fillMaxWidth().padding(horizontal = FormMetrics.RowPadding, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (label != null) Text(label, style = formLabelStyle())
        if (progress == null) IndeterminateBar() else DeterminateBar(progress.coerceIn(0f, 1f))
    }
}

@Composable
fun SectionScope.progress(
    modifier: Modifier = Modifier,
    progress: Float? = null,
    label: String? = null,
) {
    ProgressView(modifier.layoutId(FormMetrics.RowPadding), progress, label)
}

@Composable
private fun DeterminateBar(progress: Float) {
    val track = grooveColor()
    val fill = MaterialTheme.workColors.pill
    Canvas(Modifier.fillMaxWidth().height(4.dp)) {
        val radius = CornerRadius(size.height / 2f)
        drawRoundRect(track, cornerRadius = radius)
        drawRoundRect(fill, size = Size(size.width * progress, size.height), cornerRadius = radius)
    }
}

@Composable
private fun IndeterminateBar() {
    val track = grooveColor()
    val fill = MaterialTheme.workColors.pill
    val shift by rememberInfiniteTransition(label = "progress").animateFloat(
        initialValue = -0.4f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1100, easing = LinearEasing), RepeatMode.Restart),
        label = "progress shift",
    )
    Canvas(Modifier.fillMaxWidth().height(4.dp)) {
        val radius = CornerRadius(size.height / 2f)
        drawRoundRect(track, cornerRadius = radius)
        val width = size.width * 0.35f
        val left = size.width * shift
        drawRoundRect(fill, topLeft = Offset(left, 0f), size = Size(width, size.height), cornerRadius = radius)
    }
}
