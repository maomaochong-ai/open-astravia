package org.astravia.android.domain.remote

import java.net.ConnectException
import java.net.UnknownHostException
import java.util.concurrent.TimeoutException
import javax.net.ssl.SSLHandshakeException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class SignalingFailureStepTest {
    @Test
    fun namesTheStepThatFailedInsteadOfTheExceptionClass() {
        assertEquals("signaling failed: no answer from the relay in 10s", signalingFailureStep(SignalingTimeoutException(10_000)))
        assertEquals("signaling failed: relay host not found", signalingFailureStep(UnknownHostException("relay.example")))
        assertEquals("signaling failed: relay unreachable", signalingFailureStep(ConnectException("refused")))
        assertEquals("signaling failed: relay unreachable", signalingFailureStep(TimeoutException()))
        assertEquals("signaling failed: relay refused the secure connection", signalingFailureStep(SSLHandshakeException("bad")))
    }

    @Test
    fun aRefusedUpgradeIsNotReportedAsAnUnreachableRelay() {
        assertEquals("signaling failed: relay refused the viewer", signalingFailureStep(WebSocketRefused()))
    }

    @Test
    fun theMessageNeverReachesTheTrace() {
        val error = ConnectException("ws://relay.example/v2/desktop/pair-1234/viewer#pairing=secret")

        val step = signalingFailureStep(error)

        assertFalse(step.contains("pair-1234"), step)
        assertFalse(step.contains("secret"), step)
    }

    /** Stands in for the websocket exception without pulling Ktor into the assertion. */
    private class WebSocketRefused : Exception("upgrade refused, protocol astravia.pairing.secret")
}
