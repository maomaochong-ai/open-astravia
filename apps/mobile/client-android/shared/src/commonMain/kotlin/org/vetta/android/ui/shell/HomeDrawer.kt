package org.vetta.android.ui.shell

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.AwaitPointerEventScope
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerInputChange
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.vetta.android.ui.design.VettaMotion
import kotlin.math.abs

/**
 * Home as a full-width drawer over the slot (the iPhone's `HomeDrawer`). It slides in
 * from the left while the page behind shifts a quarter over and dims; dragging from the
 * left edge pulls it out and dragging left on its first page puts it away, both under the
 * finger. A system back swipe moves it the same way, so the gesture that opens Home from
 * a chat and the one that closes it follow the finger rather than snapping.
 *
 * One spring-driven value carries the drawer; a finger, a back swipe and [open] all steer
 * that value, and a new target picks up the current speed instead of starting over.
 *
 * `backProgress` is a back swipe under way (0 to 1), or null when there is none;
 * `closableByDrag` is off while a page is pushed over Home's list.
 */
@Composable
fun HomeDrawer(
    open: Boolean,
    enabled: Boolean,
    onOpenChange: (Boolean) -> Unit,
    closableByDrag: Boolean,
    backProgress: Float?,
    content: @Composable () -> Unit,
    drawer: @Composable () -> Unit,
) {
    val progress = remember { Animatable(if (open) 1f else 0f) }
    val scope = rememberCoroutineScope()
    var dragging by remember { mutableStateOf(false) }
    val currentOpen by rememberUpdatedState(open)
    val change by rememberUpdatedState(onOpenChange)
    val focus = LocalFocusManager.current
    val covered by remember { derivedStateOf { progress.value > 0f } }

    // A back swipe drags the drawer halfway at most; letting go finishes the move.
    LaunchedEffect(backProgress) {
        val swipe = backProgress ?: return@LaunchedEffect
        progress.snapTo(if (currentOpen) 1f - swipe * 0.5f else swipe * 0.5f)
    }
    LaunchedEffect(open, backProgress == null, dragging) {
        if (backProgress == null && !dragging) progress.animateTo(if (open) 1f else 0f, VettaMotion.snappy())
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val width = constraints.maxWidth.toFloat().coerceAtLeast(1f)
        val edge = with(LocalDensity.current) { EDGE.toPx() }
        val fling = with(LocalDensity.current) { FLING.toPx() }

        /** Past halfway, or flicked, it goes the rest of the way; otherwise it springs back. */
        fun settle(velocity: Float) {
            val target = if (abs(velocity) > fling) velocity > 0 else progress.value > 0.5f
            dragging = false
            if (target != currentOpen) change(target)
            scope.launch { progress.animateTo(if (target) 1f else 0f, VettaMotion.snappy(), initialVelocity = velocity / width) }
        }

        // Gestures are read on boxes that stay put; the layers inside them move, and a
        // pointer tracked on a moving layer would drift with it.
        Box(
            Modifier
                .fillMaxSize()
                .then(if (open) Modifier.clearAndSetSemantics {} else Modifier)
                .pointerInput(enabled) {
                    if (!enabled) return@pointerInput
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                        if (currentOpen || down.position.x > edge) return@awaitEachGesture
                        val start = awaitDominantHorizontalDrag(down, towardsRight = true, slop = viewConfiguration.touchSlop) ?: return@awaitEachGesture
                        focus.clearFocus()
                        dragging = true
                        val velocity = followDrag(start, down.position.x) { dx -> scope.launch { progress.snapTo((dx / width).coerceIn(0f, 1f)) } }
                        settle(velocity)
                    }
                },
        ) {
            // Clipped, so nothing a page draws past its own edge shows on the other side.
            Box(Modifier.fillMaxSize().graphicsLayer { translationX = progress.value * width * 0.25f; clip = true }) { content() }
            // The page behind dims as the drawer comes over it, and takes no touches meanwhile.
            if (covered) {
                Box(
                    Modifier
                        .fillMaxSize()
                        .graphicsLayer { alpha = progress.value }
                        .background(Color.Black.copy(alpha = 0.3f))
                        .pointerInput(Unit) { awaitEachGesture { awaitFirstDown().consume() } },
                )
            }
        }
        if (enabled) {
            Box(
                Modifier
                    .fillMaxSize()
                    .then(if (!open) Modifier.clearAndSetSemantics {} else Modifier)
                    .testTag("home.drawer")
                    // Only while open: shut, this box would sit over the slot and take its touches.
                    .then(
                        if (!open || !closableByDrag) {
                            Modifier
                        } else {
                            Modifier.pointerInput(Unit) {
                                awaitEachGesture {
                                    val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                                    val start = awaitDominantHorizontalDrag(down, towardsRight = false, slop = viewConfiguration.touchSlop) ?: return@awaitEachGesture
                                    focus.clearFocus()
                                    dragging = true
                                    val velocity = followDrag(start, down.position.x) { dx -> scope.launch { progress.snapTo((1f + dx / width).coerceIn(0f, 1f)) } }
                                    settle(velocity)
                                }
                            }
                        },
                    ),
            ) {
                Box(Modifier.fillMaxSize().graphicsLayer { translationX = (progress.value - 1f) * width; clip = true }) { drawer() }
            }
        }
    }
}

/** How close to the left edge a drag must start to pull the drawer out. */
private val EDGE = 24.dp

/** A release faster than this goes where it was flung, however far it got. */
private val FLING = 500.dp

/**
 * Waits for the pointer to travel past the touch slop mostly sideways and in the given
 * direction, and claims it then; a vertical move, a release or a child that took the
 * pointer first gives it up, so scrolling keeps working underneath.
 */
private suspend fun AwaitPointerEventScope.awaitDominantHorizontalDrag(
    down: PointerInputChange,
    towardsRight: Boolean,
    slop: Float,
): PointerInputChange? {
    var total = Offset.Zero
    while (true) {
        val event = awaitPointerEvent(PointerEventPass.Initial)
        val change = event.changes.firstOrNull { it.id == down.id } ?: return null
        if (!change.pressed || change.isConsumed) return null
        total += change.positionChange()
        if (abs(total.y) > slop && abs(total.y) >= abs(total.x)) return null
        if (abs(total.x) > slop) {
            if ((total.x > 0) != towardsRight || abs(total.x) < abs(total.y) * 1.5f) return null
            change.consume()
            return change
        }
    }
}

/**
 * Follows the claimed pointer until it lifts, reporting its sideways travel from `origin`,
 * where it went down, and returns its sideways speed in pixels per second when it let go.
 */
private suspend fun AwaitPointerEventScope.followDrag(start: PointerInputChange, origin: Float, onDrag: (Float) -> Unit): Float {
    val tracker = VelocityTracker()
    tracker.addPosition(start.uptimeMillis, start.position)
    onDrag(start.position.x - origin)
    while (true) {
        val event = awaitPointerEvent(PointerEventPass.Initial)
        val change = event.changes.firstOrNull { it.id == start.id } ?: break
        if (!change.pressed) {
            tracker.addPosition(change.uptimeMillis, change.position)
            break
        }
        change.consume()
        tracker.addPosition(change.uptimeMillis, change.position)
        onDrag(change.position.x - origin)
    }
    return tracker.calculateVelocity().x
}
