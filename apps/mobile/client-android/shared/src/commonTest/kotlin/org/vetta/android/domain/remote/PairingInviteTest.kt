package org.vetta.android.domain.remote

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PairingInviteTest {
    @Test
    fun parsesDesktopV2InviteAndBuildsAuthenticatedRelayTarget() {
        val invite = requireNotNull(parsePairingInvite(INVITE))

        assertEquals(2, invite.version)
        assertEquals("pair-1234567890abcdef", invite.pairingId)
        assertEquals("Jane's MacBook Pro", invite.desktopName)
        assertEquals(listOf("192.168.1.20:43117"), invite.lanEndpoints)
        assertEquals("wss://relay.example", invite.relayBaseUrl)

        val target = requireNotNull(buildMobileRelayTarget(invite, MOBILE_IDENTITY_SECRET))
        assertEquals(
            "wss://relay.example/v2/relay/pair-1234567890abcdef/mobile",
            requireNotNull(parseMobileConnectionTarget(target)).url,
        )
        assertEquals(invite.mobileSecret, requireNotNull(parseMobileConnectionTarget(target)).pairingSecret)
        assertEquals(invite.desktopIdentityKey, requireNotNull(parseMobileConnectionTarget(target)).desktopIdentityKey)
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
        const val MOBILE_IDENTITY_SECRET = "HyYtNDtCSVBXXmVsc3qBiI-WnaSrsrnAx87V3OPq8fg"
        const val INVITE =
            "vetta://pair?v=2&id=pair-1234567890abcdef&s=secret-1234567890abcdef&k=$DESKTOP_IDENTITY_PUBLIC&n=Jane%27s+MacBook+Pro&lan=192.168.1.20%3A43117&relay=https%3A%2F%2Frelay.example%2F"
    }
}
