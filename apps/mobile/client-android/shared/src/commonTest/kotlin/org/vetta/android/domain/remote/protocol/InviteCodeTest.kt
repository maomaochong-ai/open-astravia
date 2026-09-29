package org.vetta.android.domain.remote.protocol

import kotlinx.coroutines.test.runTest
import org.vetta.android.domain.remote.pairing.InviteCodeLookup
import org.vetta.android.domain.remote.pairing.InviteLookup
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class InviteCodeTest {
    private val nonce = ByteArray(24) { it.toByte() }

    @Test
    fun matchesTheDesktopsVector() {
        // Pinned in packages/remote-control/test/invite-code.test.ts.
        assertEquals("oe8sfyla3JaUnRAk_OqKI8DJvl48e8IfsfQ1SK6dMS4", InviteCode.boxId("K7Q29MXD"))
        val envelope = InviteCode.seal("vetta://pair?v=2", "K7Q29MXD", "482913", nonce)
        assertEquals(InviteCode.Envelope("AAECAwQFBgcICQoLDA0ODxAREhMUFRYX", "7v0nMbc3Dzwj2xiCL-L0UvCWmf7PDe03MwwUW09QZzU"), envelope)
        assertEquals("vetta://pair?v=2", InviteCode.open(envelope, "K7Q29MXD", "482913"))
        assertFailsWith<RemoteProtocolException> { InviteCode.open(envelope, "K7Q29MXD", "482914") }
    }

    @Test
    fun readsTheQrCodeTheDesktopShows() {
        // Pinned in packages/remote-control/test/invite-code.test.ts.
        assertEquals(InviteCode.Qr("K7Q29MXD", "482913"), InviteCode.parseQr("VETTA://PAIR/K7Q29MXD/482913"))
        assertEquals(
            InviteCode.Qr("K7Q29MXD", "482913", "wss://relay.mine.test"),
            InviteCode.parseQr("VETTA://PAIR/K7Q29MXD/482913?relay=wss%3A%2F%2Frelay.mine.test"),
        )
        assertEquals(InviteCode.Qr("K7Q29MXD", "482913"), InviteCode.parseQr(" vetta://pair/k7q2-9mxd/482913 "))
        assertNull(InviteCode.parseQr("vetta://pair?v=2&id=abc"), "a whole pairing link is left to parsePairingInvite")
        assertNull(InviteCode.parseQr("VETTA://PAIR/K7Q29MXD"))
        assertNull(InviteCode.parseQr("VETTA://PAIR/K7Q29MXD/48291"))
        assertNull(InviteCode.parseQr("VETTA://PAIR/K7Q29MXD/482913/extra"))
        assertNull(InviteCode.parseQr("VETTA://PAIR/K7Q29MXD/482913?relay=https%3A%2F%2Fevil.test"))
    }

    @Test
    fun readsACodeHoweverItWasTyped() {
        assertEquals("K7Q29MXD", InviteCode.normalize(" k7q2-9mxd "))
        assertEquals("01100000", InviteCode.normalize("OIL00000"))
        assertNull(InviteCode.normalize("K7Q2-9MX"))
        assertNull(InviteCode.normalize("K7Q2-9MXU"))
        assertEquals(false, InviteCode.isValidPassword("12345"))
        assertEquals(true, InviteCode.isValidPassword("012345"))
        assertEquals("https://relay.example/v2/invite/${InviteCode.boxId("K7Q29MXD")}", InviteCode.boxUrl("wss://relay.example/", "K7Q29MXD"))
    }

    @Test
    fun theBoxesKeepOnlyWhatACodeCanHold() {
        assertEquals("K7Q29MXD", InviteCode.typed("k7q2-9mxd"))
        assertEquals("01100000", InviteCode.typed("oil 00000 extra"))
        assertEquals("K7Q2", InviteCode.typed("K7Q2U!"))
        assertEquals("K7Q2-9MXD", InviteCode.format("K7Q29MXD"))
        assertEquals("K7Q", InviteCode.format("K7Q"))
    }

    @Test
    fun looksTheInviteUpOnTheRelayAndSaysWhyWhenItCannot() =
        runTest {
            val envelope = InviteCode.seal("vetta://pair?v=2&p=room", "K7Q29MXD", "482913", nonce)
            val body = """{"envelope":{"v":1,"nonce":"${envelope.nonce}","ciphertext":"${envelope.ciphertext}"}}"""
            val asked = mutableListOf<String>()
            val found = InviteCodeLookup { url -> asked += url; 200 to body }
            assertEquals(InviteLookup.Found("vetta://pair?v=2&p=room"), found.lookup("k7q2-9mxd", "482913", "wss://relay.example"))
            assertEquals(listOf(InviteCode.boxUrl("wss://relay.example", "K7Q29MXD")), asked)
            assertEquals(InviteLookup.WrongPassword, found.lookup("K7Q29MXD", "000000", "wss://relay.example"))
            assertEquals(InviteLookup.NotFound, InviteCodeLookup { 404 to """{"error":"not_found"}""" }.lookup("K7Q29MXD", "482913"))
            assertEquals(InviteLookup.Unreachable, InviteCodeLookup { null }.lookup("K7Q29MXD", "482913"))
            assertEquals(InviteLookup.Unreachable, InviteCodeLookup { 200 to "<html>" }.lookup("K7Q29MXD", "482913"))
            assertEquals(InviteLookup.NotFound, InviteCodeLookup { error("never asked") }.lookup("short", "482913"))
        }
}
