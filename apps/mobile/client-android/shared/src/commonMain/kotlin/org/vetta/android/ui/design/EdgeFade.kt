package org.vetta.android.ui.design

import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp

/**
 * Fades the content out towards its top and bottom edges instead of cutting it off, so a
 * list slides away softly under the bars floating over it (iOS's soft scroll edge).
 * `top` and `bottom` are how deep each fade reaches; zero leaves that edge sharp.
 */
fun Modifier.edgeFade(top: Dp, bottom: Dp): Modifier =
    graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
        .drawWithContent {
            drawContent()
            val topPx = top.toPx()
            val bottomPx = bottom.toPx()
            if (topPx > 0f) {
                drawRect(
                    Brush.verticalGradient(0f to Color.Transparent, 1f to Color.Black, startY = 0f, endY = topPx),
                    size = size.copy(height = topPx),
                    blendMode = BlendMode.DstIn,
                )
            }
            if (bottomPx > 0f) {
                drawRect(
                    Brush.verticalGradient(0f to Color.Black, 1f to Color.Transparent, startY = size.height - bottomPx, endY = size.height),
                    topLeft = androidx.compose.ui.geometry.Offset(0f, size.height - bottomPx),
                    size = size.copy(height = bottomPx),
                    blendMode = BlendMode.DstIn,
                )
            }
        }
