package org.vetta.android.domain.remote

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PairingInviteTest {
    @Test
    fun parsesDesktopV2InviteAndBuildsItsSocketUrls() {
        val invite = requireNotNull(parsePairingInvite(INVITE))

        assertEquals(2, invite.version)
        assertEquals("pair-1234567890abcdef", invite.pairingId)
        assertEquals("Jane's MacBook Pro", invite.desktopName)
        assertEquals(listOf("192.168.1.20:43117"), invite.lanEndpoints)
        assertEquals("wss://relay.example", invite.relayBaseUrl)

        assertEquals(
            "wss://relay.example/v2/relay/pair-1234567890abcdef/mobile",
            relayControlUrl(requireNotNull(invite.relayBaseUrl), invite.pairingId),
        )
        assertEquals("ws://192.168.1.20:43117/v2/lan/pair-1234567890abcdef", lanControlUrl(invite.lanEndpoints.single(), invite.pairingId))
        assertEquals(
            "wss://relay.example/v2/desktop/pair-1234567890abcdef/viewer#pairing=secret-1234567890abcdef",
            desktopViewerUrl(requireNotNull(invite.relayBaseUrl), invite.pairingId, invite.mobileSecret),
        )
    }

    @Test
    fun rejectsV1MalformedKeysAndInvalidEndpoints() {
        assertNull(parsePairingInvite(INVITE.replace("v=2", "v=1")))
        assertNull(parsePairingInvite(INVITE.replace(DESKTOP_IDENTITY_PUBLIC, "short")))
        assertNull(parsePairingInvite(INVITE.replace("192.168.1.20%3A43117", "host%3A70000")))
        assertNull(parsePairingInvite("https://relay.example"))
    }

    private companion object {
        const val DESKTOP_IDENTITY_PUBLIC = "V-U_7B2yLhcIrcj6dteUYQTZpeC-YvqqG-h-d--vWyI"
        const val INVITE =
            "vetta://pair?v=2&id=pair-1234567890abcdef&s=secret-1234567890abcdef&k=$DESKTOP_IDENTITY_PUBLIC&n=Jane%27s+MacBook+Pro&lan=192.168.1.20%3A43117&relay=https%3A%2F%2Frelay.example%2F"
    }
}
