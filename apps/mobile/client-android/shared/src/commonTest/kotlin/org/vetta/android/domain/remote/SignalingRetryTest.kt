package org.vetta.android.domain.remote

import kotlin.test.Test
import kotlin.test.assertEquals

class SignalingRetryTest {
    @Test
    fun endsASessionThatHasNotConnectedDirectlyYet() {
        assertEquals(SignalingDrop.Stop, SignalingRetry().dropped(directlyConnected = false))
    }

    @Test
    fun keepsADirectLinkAndBacksOffUntilSignalingIsBack() {
        val retry = SignalingRetry()
        val delays = List(7) { retry.dropped(directlyConnected = true) }
        assertEquals(listOf(1_000L, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000).map(SignalingDrop::Reconnect), delays)

        retry.reopened()
        assertEquals(SignalingDrop.Reconnect(1_000), retry.dropped(directlyConnected = true))
    }
}
