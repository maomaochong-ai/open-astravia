package org.vetta.android.domain.remote

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class RemoteDesktopTargetTest {
    @Test
    fun convertsControlRelayTargetToViewerTarget() {
        val id = "pairing-id-1234567890123456789012"
        val target = remoteDesktopViewerTarget("wss://relay.example/v1/relay/$id/mobile#secret")

        assertEquals("wss://relay.example/v1/desktop/$id/viewer#secret", target?.url)
        assertEquals(id, target?.sessionId)
    }

    @Test
    fun rejectsLegacyOrMalformedTargets() {
        assertNull(remoteDesktopViewerTarget("127.0.0.1:8787#pair"))
    }
}
