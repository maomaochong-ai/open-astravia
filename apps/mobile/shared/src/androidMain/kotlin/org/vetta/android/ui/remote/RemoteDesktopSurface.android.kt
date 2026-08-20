package org.vetta.android.ui.remote

import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

@Composable
actual fun RemoteDesktopSurface(target: String, modifier: Modifier) {
    val context = LocalContext.current
    val session = remember(target) { NativeRemoteDesktopSession(context.applicationContext, target) }
    val focusRequester = remember { FocusRequester() }
    var size = remember { IntSize.Zero }
    DisposableEffect(session) {
        session.start()
        onDispose { session.stop() }
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
    Box(
        modifier
            .onSizeChanged { size = it }
            .focusRequester(focusRequester)
            .focusable()
            .onKeyEvent { event ->
                val action = if (event.type == KeyEventType.KeyDown) "down" else "up"
                session.sendKey(androidKeyCode(event.key.keyCode.toInt()), action)
                true
            }
            .pointerInput(session, size) {
                detectTapGestures(
                    onPress = { offset ->
                        focusRequester.requestFocus()
                        val x = if (size.width == 0) .5f else offset.x / size.width
                        val y = if (size.height == 0) .5f else offset.y / size.height
                        session.sendPointer("pointer.button", x, y, "left", "down")
                        tryAwaitRelease()
                        session.sendPointer("pointer.button", x, y, "left", "up")
                    },
                )
            }
            .pointerInput(session, size) {
                detectDragGestures(
                    onDragStart = { offset ->
                        focusRequester.requestFocus()
                        val x = if (size.width == 0) .5f else offset.x / size.width
                        val y = if (size.height == 0) .5f else offset.y / size.height
                        session.sendPointer("pointer.button", x, y, "left", "down")
                    },
                    onDrag = { change, _ ->
                        val x = if (size.width == 0) .5f else change.position.x / size.width
                        val y = if (size.height == 0) .5f else change.position.y / size.height
                        session.sendPointer("pointer.move", x, y)
                    },
                    onDragEnd = { session.sendPointer("pointer.button", .5f, .5f, "left", "up") },
                    onDragCancel = { session.sendPointer("pointer.button", .5f, .5f, "left", "up") },
                )
            },
    ) {
        AndroidView(modifier = Modifier.matchParentSize(), factory = { session.createRenderer() })
    }
}

private fun androidKeyCode(code: Int): String = when {
    code in 29..54 -> "Key${('A'.code + code - 29).toChar()}"
    code in 7..16 -> "Digit${code - 7}"
    else -> mapOf(
        66 to "Enter", 111 to "Escape", 67 to "Backspace", 61 to "Tab", 62 to "Space",
        19 to "ArrowUp", 20 to "ArrowDown", 21 to "ArrowLeft", 22 to "ArrowRight", 112 to "Delete",
    )[code] ?: "AndroidKey$code"
}
