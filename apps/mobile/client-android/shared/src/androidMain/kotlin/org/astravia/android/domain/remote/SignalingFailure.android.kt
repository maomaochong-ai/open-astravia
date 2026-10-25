package org.astravia.android.domain.remote

import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.UnknownHostException
import java.util.concurrent.TimeoutException
import javax.net.ssl.SSLException

/**
 * The websocket upgrade to the relay never completed within [timeoutMs]. Without it a relay that
 * silently drops the connection (DNS blackhole, blocked TLS, no route) leaves the viewer saying
 * `signaling connecting` for as long as the page is open.
 */
class SignalingTimeoutException(val timeoutMs: Long) : IllegalStateException("signaling did not open within $timeoutMs ms")

/**
 * The last line of the connection trace: which step failed, in words a user can act on.
 * The exception's message is never shown — it carries the relay URL and the pairing secret, and
 * the trace is drawn on screen and copied into logs.
 */
fun signalingFailureStep(error: Throwable): String =
    when (error) {
        is SignalingTimeoutException -> "signaling failed: no answer from the relay in ${error.timeoutMs / 1_000}s"
        is UnknownHostException -> "signaling failed: relay host not found"
        is ConnectException, is NoRouteToHostException, is TimeoutException -> "signaling failed: relay unreachable"
        is SSLException -> "signaling failed: relay refused the secure connection"
        else -> {
            val name = error::class.simpleName.orEmpty()
            if (name.contains("WebSocket")) "signaling failed: relay refused the viewer" else "signaling failed: $name"
        }
    }
