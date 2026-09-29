package org.vetta.android.ui.remote

import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.AwaitPointerEventScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.toSize
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.domain.remote.RemoteKeyStroke
import org.vetta.android.domain.remote.RemoteKeys
import org.vetta.android.domain.remote.RemotePointerCommand
import org.vetta.android.domain.remote.RemoteScreenCursor
import org.vetta.android.domain.remote.RemoteStreamStats
import org.vetta.android.domain.remote.RemoteTrackpad
import org.vetta.android.domain.remote.RemoteTyping
import org.vetta.android.domain.remote.RemoteViewport
import org.vetta.android.domain.remote.WheelNotches
import org.vetta.android.resources.Res
import org.vetta.android.resources.remote_details
import org.vetta.android.resources.remote_frames_per_second
import org.vetta.android.resources.remote_picture_delay
import org.vetta.android.resources.remote_round_trip
import org.vetta.android.resources.remote_route_internet
import org.vetta.android.resources.remote_route_lan
import org.vetta.android.resources.remote_route_relayed

@Composable
actual fun RemoteDesktopSurface(
    target: String,
    modifier: Modifier,
    keyboardOpen: Boolean,
    onKeyboardClosed: () -> Unit,
    cursor: RemoteScreenCursor?,
) {
    val scope = rememberCoroutineScope()
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
    val stats by session.stats.collectAsState()
    val trace by session.trace.collectAsState()
    // The screen stays on while the desktop is being watched.
    val view = LocalView.current
    DisposableEffect(view) {
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = false }
    }
    val current by rememberUpdatedState(viewport)
    val trackpad = remember(session) { RemoteTrackpad() }
    // Where the pointer is drawn; the trackpad itself is not observable.
    var pointer by remember(session) { mutableStateOf(trackpad.x to trackpad.y) }
    // The unzoomed picture inside the whole touch area, which may be larger.
    var picture by remember { mutableStateOf(Rect.Zero) }
    val density = LocalDensity.current

    fun send(commands: List<RemotePointerCommand>) = commands.forEach { session.sendPointer(it.type, it.x, it.y, it.button, it.action) }

    // The whole page is the trackpad: fingers work on the bars around the picture too.
    Box(
        modifier
            .clipToBounds()
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
                    if (picture.isEmpty) return@awaitEachGesture
                    val moveThreshold = MOVE_THRESHOLD_DP * density.density
                    // Holding still half a second presses the button; moving then drags.
                    var held = false
                    val hold =
                        scope.launch {
                            delay(HOLD_MS)
                            held = true
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            send(listOf(trackpad.press("down")))
                        }
                    var travel = 0f
                    var twoFingers = false
                    try {
                        while (true) {
                            val event = awaitPointerEvent()
                            if (event.changes.count { it.pressed } >= 2) {
                                twoFingers = true
                                break
                            }
                            val change = event.changes.firstOrNull { it.id == down.id } ?: break
                            if (!change.pressed) break
                            change.consume()
                            val delta = change.position - change.previousPosition
                            travel += delta.getDistance()
                            if (!held && travel > HOLD_SLOP_DP * density.density) hold.cancel()
                            if (travel < moveThreshold) continue
                            val seconds = ((change.uptimeMillis - change.previousUptimeMillis).coerceAtLeast(8)) / 1000f
                            val speed = delta.getDistance() / density.density / seconds
                            trackpad.move(delta.x, delta.y, speed, picture.width * current.zoom, picture.height * current.zoom)?.let {
                                send(listOf(it))
                                pointer = trackpad.x to trackpad.y
                            }
                        }
                    } finally {
                        hold.cancel()
                    }
                    when {
                        held -> send(listOf(trackpad.press("up")))
                        twoFingers -> {
                            val start = down.uptimeMillis
                            val moved =
                                twoFingers(
                                    slop = viewConfiguration.touchSlop,
                                    zoomed = { current.zoomed },
                                    onTransform = { factor, focus, move ->
                                        viewport = current.transformed(factor, focus.x - picture.left, focus.y - picture.top, move.x, move.y, picture.width, picture.height)
                                    },
                                    onScroll = { delta -> session.sendScroll(0f, delta.toFloat()) },
                                )
                            // Two fingers down and up without moving: a right-click where the pointer is.
                            if (!moved.first && moved.second - start < TWO_FINGER_TAP_MS) {
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                send(trackpad.click("right"))
                            }
                        }
                        travel < moveThreshold -> send(trackpad.click("left"))
                    }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        // Sized to the stream's own shape, so the picture fills it without bars.
        Box(
            Modifier
                .then(frame?.takeIf { it.width > 0 && it.height > 0 }?.let { Modifier.aspectRatio(it.width.toFloat() / it.height) } ?: Modifier.fillMaxSize())
                .onGloballyPositioned { coordinates ->
                    val offset = coordinates.positionInParent()
                    picture = Rect(offset, coordinates.size.toSize())
                },
        ) {
            key(session) {
                AndroidView(
                    modifier = Modifier.matchParentSize(),
                    factory = { session.createRenderer() },
                    onRelease = session::releaseRenderer,
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
        if (!picture.isEmpty && frame != null) {
            val (x, y) = viewport.toView(pointer.first, pointer.second, picture.width, picture.height)
            RemotePointer(Offset(picture.left + x, picture.top + y), cursor, shownWidth = picture.width * viewport.zoom / density.density)
        }
        // Route, latency and frame rate, so a slow network and a slow picture can be told apart.
        stats?.let { StatsLine(it, Modifier.align(Alignment.TopCenter)) }
        // No picture yet: what the direct connection got through so far, to tell where it stops.
        if (frame == null && trace.isNotEmpty()) ConnectionTrace(trace, Modifier.align(Alignment.BottomStart))
        RemoteKeyboard(keyboardOpen, onKeyboardClosed) { typing ->
            when (typing) {
                is RemoteTyping.Text -> session.sendText(typing.text)
                is RemoteTyping.Key -> {
                    val stroke = typing.stroke
                    if (stroke.shift) session.sendKey("ShiftLeft", "down")
                    session.sendKey(stroke.code, "down")
                    session.sendKey(stroke.code, "up")
                    if (stroke.shift) session.sendKey("ShiftLeft", "up")
                }
            }
        }
    }
}

@Composable
private fun ConnectionTrace(steps: List<String>, modifier: Modifier = Modifier) {
    Column(modifier.padding(16.dp).testTag("remote.trace")) {
        Text(stringResource(Res.string.remote_details), style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold), color = Color.White.copy(alpha = 0.5f))
        steps.forEach { step ->
            Text(step, style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace), color = Color.White.copy(alpha = 0.5f))
        }
    }
}

@Composable
private fun StatsLine(stats: RemoteStreamStats, modifier: Modifier = Modifier) {
    val parts =
        listOfNotNull(
            when (stats.route) {
                RemoteStreamStats.Route.Lan -> stringResource(Res.string.remote_route_lan)
                RemoteStreamStats.Route.Internet -> stringResource(Res.string.remote_route_internet)
                RemoteStreamStats.Route.Relayed -> stringResource(Res.string.remote_route_relayed)
                null -> null
            },
            stats.roundTripMs?.let { stringResource(Res.string.remote_round_trip, it.roundToInt()) },
            stats.pictureDelayMs?.let { stringResource(Res.string.remote_picture_delay, it.roundToInt()) },
            stats.framesPerSecond?.let { stringResource(Res.string.remote_frames_per_second, it.roundToInt()) },
            if (stats.frameWidth != null && stats.frameHeight != null) "${stats.frameWidth}×${stats.frameHeight}" else null,
        )
    if (parts.isEmpty()) return
    Text(
        parts.joinToString(" · "),
        style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = "tnum"),
        color = Color.White.copy(alpha = 0.8f),
        modifier =
            modifier
                .padding(top = 6.dp)
                .background(Color.Black.copy(alpha = 0.45f), RoundedCornerShape(50))
                .padding(horizontal = 10.dp, vertical = 4.dp)
                .testTag("remote.stats"),
    )
}

/** A finger has to travel this far before it moves the pointer, so a tap does not nudge it. */
private const val MOVE_THRESHOLD_DP = 3f

/** Holding this long presses the button, as long as the finger stayed within [HOLD_SLOP_DP]. */
private const val HOLD_MS = 500L
private const val HOLD_SLOP_DP = 10f

/** Two fingers lifted this soon without moving are a right-click. */
private const val TWO_FINGER_TAP_MS = 300L

/**
 * The desktop's pointer, drawn by the phone where the trackpad put it: in the shape the
 * desktop reports (at a readable size), or a plain arrow when it reports none. `position`
 * is the hot spot, in pixels of the touch area.
 */
@Composable
private fun BoxScope.RemotePointer(position: Offset, cursor: RemoteScreenCursor?, shownWidth: Float) {
    val image = remember(cursor) { cursor?.let { BitmapFactory.decodeByteArray(it.image, 0, it.image.size)?.asImageBitmap() } }
    val density = LocalDensity.current
    if (cursor != null && image != null) {
        val scale = cursor.scale(shownWidth)
        val left = position.x - with(density) { (cursor.hotspotX * scale).dp.toPx() }
        val top = position.y - with(density) { (cursor.hotspotY * scale).dp.toPx() }
        Image(
            image,
            contentDescription = null,
            modifier =
                Modifier
                    .align(Alignment.TopStart)
                    .offset { IntOffset(left.roundToInt(), top.roundToInt()) }
                    .size((cursor.width * scale).dp, (cursor.height * scale).dp)
                    .testTag("remote.pointer"),
        )
    } else {
        Canvas(
            Modifier
                .align(Alignment.TopStart)
                .offset { IntOffset(position.x.roundToInt(), position.y.roundToInt()) }
                .size(14.dp, 21.dp)
                .testTag("remote.pointer"),
        ) {
            val unit = size.width / 17f
            val arrow =
                Path().apply {
                    moveTo(0f, 0f)
                    lineTo(0f, 22f * unit)
                    lineTo(5.5f * unit, 17f * unit)
                    lineTo(9.5f * unit, 26f * unit)
                    lineTo(13.5f * unit, 24.2f * unit)
                    lineTo(9.6f * unit, 15.5f * unit)
                    lineTo(16.5f * unit, 15.5f * unit)
                    close()
                }
            drawPath(arrow, Color.Black)
            drawPath(arrow, Color.White, style = Stroke(width = 1.2f * unit))
        }
    }
}

/**
 * Two fingers until they lift: a spread or squeeze past the slop zooms the picture (the
 * shared move pans it along); otherwise their shared travel pans a zoomed picture, or
 * scrolls the desktop by wheel notches. Which one is decided once, so a scroll does not
 * wobble into a zoom. Returns whether they did anything, and when the last one lifted.
 */
private suspend fun AwaitPointerEventScope.twoFingers(
    slop: Float,
    zoomed: () -> Boolean,
    onTransform: (factor: Float, focus: Offset, move: Offset) -> Unit,
    onScroll: (wheelDelta: Int) -> Unit,
): Pair<Boolean, Long> {
    var zooming: Boolean? = null
    var span = 0f
    var startSpan = 0f
    var focus = Offset.Zero
    var travel = Offset.Zero
    val wheel = WheelNotches(step = 48f)
    while (true) {
        val changes = awaitPointerEvent().changes
        val pressed = changes.filter { it.pressed }
        if (pressed.isEmpty()) return (zooming != null) to (changes.maxOfOrNull { it.uptimeMillis } ?: 0L)
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
 * A hidden text field that holds the phone's keyboard while it types on the desktop: what is
 * typed is sent once the keyboard commits it, so a word being composed (pinyin, say) reaches
 * the desktop as the characters picked, not the letters spelled. Deleting presses Backspace
 * and the keyboard's action key presses Enter. A single invisible character keeps Backspace
 * working on an empty field.
 */
@Composable
private fun RemoteKeyboard(open: Boolean, onClosed: () -> Unit, onType: (RemoteTyping) -> Unit) {
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
            value =
                when {
                    // Still composing: the keyboard owns the text until it commits.
                    next.composition != null && text.startsWith(SENTINEL) -> next
                    else -> {
                        when {
                            text.length > SENTINEL.length -> RemoteKeys.typing(text.removePrefix(SENTINEL)).forEach(onType)
                            text.length < SENTINEL.length -> onType(RemoteTyping.Key(RemoteKeyStroke("Backspace")))
                        }
                        TextFieldValue(SENTINEL, TextRange(SENTINEL.length))
                    }
                }
        },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text, imeAction = ImeAction.Send, autoCorrectEnabled = false),
        keyboardActions = KeyboardActions(onSend = { onType(RemoteTyping.Key(RemoteKeyStroke("Enter"))) }),
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
