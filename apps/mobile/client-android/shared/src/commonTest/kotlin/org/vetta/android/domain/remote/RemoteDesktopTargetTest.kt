package org.vetta.android.domain.remote

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class RemoteDesktopTargetTest {
    @Test
    fun convertsControlRelayTargetToViewerTarget() {
        val id = "pairing-id-1234567890123456789012"
        val control =
            "wss://relay.example/v2/relay/$id/mobile" +
                "#pairing=secret-1234567890abcdefghijklmnop" +
                "&identity=HyYtNDtCSVBXXmVsc3qBiI-WnaSrsrnAx87V3OPq8fg" +
                "&peer=V-U_7B2yLhcIrcj6dteUYQTZpeC-YvqqG-h-d--vWyI"
        val target = remoteDesktopViewerTarget(control)

        assertEquals(
            "wss://relay.example/v2/desktop/$id/viewer#pairing=secret-1234567890abcdefghijklmnop",
            target?.url,
        )
        assertEquals(id, target?.sessionId)
    }

    @Test
    fun rejectsLegacyOrMalformedTargets() {
        assertNull(remoteDesktopViewerTarget("127.0.0.1:8787#pair"))
    }
}
