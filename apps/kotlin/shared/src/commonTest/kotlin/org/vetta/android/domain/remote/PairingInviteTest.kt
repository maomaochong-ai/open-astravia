package org.vetta.android.domain.remote

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PairingInviteTest {
    @Test
    fun parsesInviteAndBuildsBootstrapAndResumeTargets() {
        val invite = parsePairingInvite(
            "vetta://pair?relay=https%3A%2F%2Frelay.example&pairingId=pairing_0123456789abcdefghijklmno&bootstrap=secret_0123456789abcdefghijklmnopqrstuvwxyz",
        )
        requireNotNull(invite)
        assertEquals("https://relay.example", invite.relayBaseUrl)
        assertEquals(
            "wss://relay.example/v1/relay/pairing_0123456789abcdefghijklmno/mobile#pairing=secret_0123456789abcdefghijklmnopqrstuvwxyz&resume=resume_0123456789abcdefghijklmnopqrstuvwxyz",
			buildMobileBootstrapTarget(invite, "resume_0123456789abcdefghijklmnopqrstuvwxyz"),
        )
        assertEquals(
            "wss://relay.example/v1/relay/pairing_0123456789abcdefghijklmno/mobile#pairing=resume_0123456789abcdefghijklmnopqrstuvwxyz",
            buildMobileResumeTarget(invite, "resume_0123456789abcdefghijklmnopqrstuvwxyz"),
        )
    }

    @Test
    fun rejectsInvalidInvite() {
        assertNull(parsePairingInvite("https://relay.example"))
        assertNull(parsePairingInvite("vetta://pair?relay=ftp%3A%2F%2Frelay.example&pairingId=short&bootstrap=short"))
    }
}
