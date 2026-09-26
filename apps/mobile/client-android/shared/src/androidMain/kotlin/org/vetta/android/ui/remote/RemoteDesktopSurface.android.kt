package org.vetta.android.ui.remote

import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.AwaitPointerEventScope
import androidx.compose.ui.input.pointer.PointerInputChange
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.vetta.android.domain.remote.RemoteKeyStroke
import org.vetta.android.domain.remote.RemoteKeys
import org.vetta.android.domain.remote.RemoteViewport
import org.vetta.android.domain.remote.WheelNotches
import kotlin.math.abs

@Composable
actual fun RemoteDesktopSurface(
    target: String,
    modifier: Modifier,
    keyboardOpen: Boolean,
    onKeyboardClosed: () -> Unit,
) {
    val context = LocalContext.current
    NativeRemoteDesktopSessions.configure(context.applicationContext)
    val sessions = remember(target) { NativeRemoteDesktopSessions.observe(target) }
    val observed by sessions.collectAsState()
    // The link's own session when it is live; once one stops (the P2P channel closed), a new
    // one takes over the picture, since a stopped session has released its video.
    var session by remember(target) { mutableStateOf(observed?.takeUnless { it.isStopped } ?: NativeRemoteDesktopSessions.session(target)) }
    LaunchedEffect(observed) { observed?.takeUnless { it.isStopped }?.let { session = it } }
    val stopped by session.stoppedState.collectAsState()
    LaunchedEffect(session, stopped) { if (stopped) session = NativeRemoteDesktopSessions.session(target) }
    val focusRequester = remember { FocusRequester() }
    var size by remember { mutableStateOf(IntSize.Zero) }
    var viewport by remember { mutableStateOf(RemoteViewport()) }
    val haptics = LocalHapticFeedback.current
    DisposableEffect(session) {
        session.start()
        onDispose { session.pauseRenderer() }
    }
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(session, lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START, Lifecycle.Event.ON_RESUME -> session.resumeRenderer()
                Lifecycle.Event.ON_PAUSE, Lifecycle.Event.ON_STOP -> session.pauseRenderer()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    val frame by session.frameSize.collectAsState()
    // The screen stays on while the desktop is being watched.
    val view = LocalView.current
    DisposableEffect(view) {
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = false }
    }
    val current by rememberUpdatedState(viewport)

    fun desktopPoint(position: Offset): Pair<Float, Float> = current.toDesktop(position.x, position.y, size.width.toFloat(), size.height.toFloat())

    fun click(position: Offset, button: String) {
        val (x, y) = desktopPoint(position)
        session.sendPointer("pointer.button", x, y, button, "down")
        session.sendPointer("pointer.button", x, y, button, "up")
    }

    // Sized to the stream's own shape, so a touch maps straight onto the desktop's screen
    // instead of onto the bars the picture is fitted between.
    Box(modifier, contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .then(frame?.takeIf { it.width > 0 && it.height > 0 }?.let { Modifier.aspectRatio(it.width.toFloat() / it.height) } ?: Modifier.fillMaxSize())
                .clipToBounds()
                .onSizeChanged { size = it }
                .focusRequester(focusRequester)
                .focusable()
                .onKeyEvent { event ->
                    val action = if (event.type == KeyEventType.KeyDown) "down" else "up"
                    session.sendKey(androidKeyCode(event.key.keyCode.toInt()), action)
                    true
                }.pointerInput(session) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        if (!keyboardOpen) focusRequester.requestFocus()
                        val slop = viewConfiguration.touchSlop
                        val start = down.position
                        // A second finger, a move, a release, or holding still decides what the touch is.
                        val kind =
                            withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
                                awaitTouchKind(down, slop)
                            } ?: TouchKind.LongPress
                        when (kind) {
                            TouchKind.Tap -> click(start, "left")
                            TouchKind.LongPress -> {
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                click(start, "right")
                                drain(down)
                            }
                            TouchKind.Drag -> {
                                val (x, y) = desktopPoint(start)
                                session.sendPointer("pointer.button", x, y, "left", "down")
                                var last = start
                                follow(down) { change ->
                                    last = change.position
                                    val (mx, my) = desktopPoint(change.position)
                                    session.sendPointer("pointer.move", mx, my)
                                }
                                val (ux, uy) = desktopPoint(last)
                                session.sendPointer("pointer.button", ux, uy, "left", "up")
                            }
                            TouchKind.TwoFingers ->
                                twoFingers(
                                    slop = slop,
                                    zoomed = { current.zoomed },
                                    onTransform = { factor, focus, move ->
                                        viewport = current.transformed(factor, focus.x, focus.y, move.x, move.y, size.width.toFloat(), size.height.toFloat())
                                    },
                                    onScroll = { delta -> session.sendScroll(0f, delta.toFloat()) },
                                )
                        }
                    }
                },
        ) {
            key(session) {
                AndroidView(
                    modifier = Modifier.matchParentSize(),
                    factory = { session.createRenderer() },
                    // The picture zooms and pans on the view itself; a SurfaceView ignores Compose's layer transforms.
                    update = { renderer ->
                        renderer.scaleX = viewport.zoom
                        renderer.scaleY = viewport.zoom
                        renderer.translationX = viewport.panX
                        renderer.translationY = viewport.panY
                    },
                )
            }
        }
        RemoteKeyboard(keyboardOpen, onKeyboardClosed) { stroke ->
            if (stroke.shift) session.sendKey("ShiftLeft", "down")
            session.sendKey(stroke.code, "down")
            session.sendKey(stroke.code, "up")
            if (stroke.shift) session.sendKey("ShiftLeft", "up")
        }
    }
}

private enum class TouchKind { Tap, LongPress, Drag, TwoFingers }

/** Waits until the touch shows what it is; holding still past the caller's timeout makes it a long press. */
private suspend fun AwaitPointerEventScope.awaitTouchKind(down: PointerInputChange, slop: Float): TouchKind {
    while (true) {
        val event = awaitPointerEvent()
        if (event.changes.count { it.pressed } >= 2) return TouchKind.TwoFingers
        val change = event.changes.firstOrNull { it.id == down.id } ?: return TouchKind.Tap
        if (!change.pressed) return TouchKind.Tap
        if ((change.position - down.position).getDistance() > slop) return TouchKind.Drag
    }
}

/** Follows one finger until it lifts. */
private suspend fun AwaitPointerEventScope.follow(down: PointerInputChange, onMove: (PointerInputChange) -> Unit) {
    while (true) {
        val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: return
        if (!change.pressed) return
        change.consume()
        onMove(change)
    }
}

/** Lets the gesture run out, e.g. after a long press has already clicked. */
private suspend fun AwaitPointerEventScope.drain(down: PointerInputChange) = follow(down) {}

/**
 * Two fingers until they lift: a spread or squeeze past the slop zooms the picture (the
 * shared move pans it along); otherwise their shared travel pans a zoomed picture, or
 * scrolls the desktop by wheel notches. Which one is decided once, so a scroll does not
 * wobble into a zoom.
 */
private suspend fun AwaitPointerEventScope.twoFingers(
    slop: Float,
    zoomed: () -> Boolean,
    onTransform: (factor: Float, focus: Offset, move: Offset) -> Unit,
    onScroll: (wheelDelta: Int) -> Unit,
) {
    var zooming: Boolean? = null
    var span = 0f
    var startSpan = 0f
    var focus = Offset.Zero
    var travel = Offset.Zero
    val wheel = WheelNotches(step = 48f)
    while (true) {
        val pressed = awaitPointerEvent().changes.filter { it.pressed }
        if (pressed.isEmpty()) return
        if (pressed.size < 2) continue
        pressed.forEach { it.consume() }
        val center = Offset(pressed.map { it.position.x }.average().toFloat(), pressed.map { it.position.y }.average().toFloat())
        val nextSpan = pressed.map { (it.position - center).getDistance() }.average().toFloat()
        if (span == 0f) {
            span = nextSpan
            startSpan = nextSpan
            focus = center
            continue
        }
        val move = center - focus
        travel += move
        if (zooming == null) {
            if (abs(nextSpan - startSpan) > slop) zooming = true else if (travel.getDistance() > slop) zooming = false
        }
        when {
            zooming == true -> onTransform(nextSpan / span, center, move)
            zooming == false && zoomed() -> onTransform(1f, center, move)
            zooming == false -> wheel.add(move.y).takeIf { it != 0 }?.let { onScroll(it * WheelNotches.WHEEL_DELTA) }
        }
        span = nextSpan
        focus = center
    }
}

/**
 * A hidden text field that holds the phone's keyboard while it types on the desktop: every
 * character typed becomes key presses, deleting presses Backspace and the keyboard's action
 * key presses Enter. A single invisible character keeps Backspace working on an empty field.
 */
@Composable
private fun RemoteKeyboard(open: Boolean, onClosed: () -> Unit, onStroke: (RemoteKeyStroke) -> Unit) {
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    var value by remember { mutableStateOf(TextFieldValue(SENTINEL, TextRange(SENTINEL.length))) }
    var focused by remember { mutableStateOf(false) }
    val closed by rememberUpdatedState(onClosed)
    LaunchedEffect(open) {
        if (open) {
            focus.requestFocus()
            keyboard?.show()
        } else {
            keyboard?.hide()
        }
    }
    if (!open) return
    BasicTextField(
        value = value,
        onValueChange = { next ->
            val text = next.text
            when {
                text.length > SENTINEL.length -> RemoteKeys.strokes(text.removePrefix(SENTINEL)).forEach(onStroke)
                text.length < SENTINEL.length -> onStroke(RemoteKeyStroke("Backspace"))
            }
            value = TextFieldValue(SENTINEL, TextRange(SENTINEL.length))
        },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Send, autoCorrectEnabled = false),
        keyboardActions = KeyboardActions(onSend = { onStroke(RemoteKeyStroke("Enter")) }),
        modifier =
            Modifier
                .size(1.dp)
                .alpha(0f)
                .focusRequester(focus)
                .onFocusChanged {
                    if (focused && !it.isFocused) closed()
                    focused = it.isFocused
                },
    )
}

private const val SENTINEL = "​"

private fun androidKeyCode(code: Int): String = when {
    code in 29..54 -> "Key${('A'.code + code - 29).toChar()}"
    code in 7..16 -> "Digit${code - 7}"
    else -> mapOf(
        66 to "Enter", 111 to "Escape", 67 to "Backspace", 61 to "Tab", 62 to "Space",
        19 to "ArrowUp", 20 to "ArrowDown", 21 to "ArrowLeft", 22 to "ArrowRight", 112 to "Delete",
    )[code] ?: "AndroidKey$code"
}
