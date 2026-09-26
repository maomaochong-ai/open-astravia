package org.vetta.android.ui.design

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.SpringSpec
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.IntSize

/**
 * The app's springs, named after SwiftUI's so both apps move alike. Springs keep their
 * velocity when a new target arrives mid-flight, so a change that interrupts another
 * bends into it instead of restarting: the continuous motion the iPhone app has.
 */
object VettaMotion {
    /** SwiftUI's `.snappy`: quick and settled, without a visible bounce. */
    fun <T> snappy(visibilityThreshold: T? = null): SpringSpec<T> =
        spring(dampingRatio = 0.86f, stiffness = 520f, visibilityThreshold = visibilityThreshold)

    /** SwiftUI's `.smooth`: unhurried and critically damped, for things that glide. */
    fun <T> smooth(visibilityThreshold: T? = null): SpringSpec<T> =
        spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = 260f, visibilityThreshold = visibilityThreshold)

    /** A touch of overshoot, for things the finger lets go of. */
    fun <T> bouncy(visibilityThreshold: T? = null): SpringSpec<T> =
        spring(dampingRatio = 0.72f, stiffness = 420f, visibilityThreshold = visibilityThreshold)

    /** How far a pressed control shrinks. */
    const val PRESSED_SCALE = 0.94f
}

/** Size changes follow a spring, so a control that grows or shrinks morphs rather than jumps. */
fun Modifier.springContentSize(): Modifier = animateContentSize(VettaMotion.snappy(IntSize(1, 1)))

/**
 * Shrinks while pressed and springs back on release, following the finger's own
 * interaction source; `highlight` darkens the shape a little while held, like a glass
 * control lighting up under a touch.
 */
fun Modifier.pressScale(
    interactionSource: MutableInteractionSource,
    pressedScale: Float = VettaMotion.PRESSED_SCALE,
    highlight: Shape? = null,
): Modifier =
    composed {
        val pressed by interactionSource.collectIsPressedAsState()
        val scale by animateFloatAsState(if (pressed) pressedScale else 1f, VettaMotion.bouncy(), label = "press scale")
        val tint by animateFloatAsState(if (pressed) 1f else 0f, VettaMotion.snappy(), label = "press highlight")
        graphicsLayer {
            scaleX = scale
            scaleY = scale
        }.then(
            if (highlight == null) {
                Modifier
            } else {
                Modifier.drawWithContent {
                    drawContent()
                    if (tint > 0f) drawOutline(highlight.createOutline(size, layoutDirection, this), Color.Black.copy(alpha = 0.08f * tint))
                }
            },
        )
    }

/**
 * A tap target without Material's ripple: it presses in and springs back instead, as
 * iOS controls do. `onLongClick` adds a long press, e.g. for a context menu.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun Modifier.springClickable(
    enabled: Boolean = true,
    role: Role? = Role.Button,
    pressedScale: Float = VettaMotion.PRESSED_SCALE,
    highlight: Shape? = null,
    onLongClick: (() -> Unit)? = null,
    onClick: () -> Unit,
): Modifier {
    val interaction = remember { MutableInteractionSource() }
    return this
        .pressScale(interaction, if (enabled) pressedScale else 1f, highlight)
        .combinedClickable(
            interactionSource = interaction,
            indication = null,
            enabled = enabled,
            role = role,
            onLongClick = onLongClick,
            onClick = onClick,
        )
}
