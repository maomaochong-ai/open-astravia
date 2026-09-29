package org.vetta.android.ui.work

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/**
 * Vetta's face, drawn like the desktop's `BotAvatar` in its black-and-white theme:
 * a rounded square with two round eyes cut out of it, so whatever is behind shows
 * through them. Asleep, the eyes close to slits. Static on purpose; a tap blinks it once.
 */
@Composable
fun BotAvatar(
    size: Dp = 24.dp,
    asleep: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val face = if (dark) Color(0xFFE4E4E4) else Color.Black
    var blinking by remember { mutableStateOf(false) }
    val openness by animateFloatAsState(if (asleep || blinking) 0.15f else 1f, tween(if (blinking) 150 else 300), label = "bot eyes")
    LaunchedEffect(blinking) {
        if (blinking) {
            delay(160)
            blinking = false
        }
    }
    Canvas(
        modifier
            .size(size)
            // Offscreen, so clearing the eyes cuts through the face only, not what is behind it.
            .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
            // A tap only makes it blink: nothing for a screen reader to stop at.
            .clearAndSetSemantics {}
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                if (!asleep && !blinking) blinking = true
            },
    ) {
        val side = this.size.minDimension
        drawRoundRect(
            brush = Brush.linearGradient(listOf(face, face.copy(alpha = 0.85f)), Offset.Zero, Offset(side, side)),
            cornerRadius = CornerRadius(side * 0.3f),
        )
        val eye = side * 0.15f
        val eyeHeight = eye * openness
        val top = (side - eyeHeight) / 2
        val left = (side - eye * 3) / 2
        for (x in listOf(left, left + eye * 2)) {
            drawOval(Color.Black, topLeft = Offset(x, top), size = Size(eye, eyeHeight), blendMode = BlendMode.Clear)
        }
    }
}
