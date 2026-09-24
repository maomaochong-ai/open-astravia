package org.vetta.android.domain.remote.pairing

import kotlinx.coroutines.async
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.vetta.android.domain.remote.protocol.RemoteCrypto
import org.vetta.android.domain.remote.protocol.RemoteErrorCode
import org.vetta.android.domain.work.FakeDesktop
import org.vetta.android.domain.work.eventually
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PairingFlowTest {
    private val identity = RemoteCrypto.generateIdentityKeyPair()
    private val phases = mutableListOf<PairingPhase>()

    private fun TestScope.flow(desktop: FakeDesktop): PairingFlow =
        PairingFlow(
            PairingFlowOptions(
                identity = identity,
                deviceId = "phone-1",
                deviceName = "Pixel",
                createTransport = desktop.createTransport,
                onPhase = { phases += it },
                now = { testScheduler.currentTime },
            ),
            backgroundScope,
        )

    @Test
    fun aScannedCodeTriesTheLocalNetworkBeforeTheRelay() =
        runTest {
            val desktop = FakeDesktop(backgroundScope)
            val invite = desktop.invite(lan = listOf(FakeDesktop.LAN_ENDPOINT))

            val record = assertNotNull(flow(desktop).pairWithCode(invite))
            assertEquals(listOf("ws://${FakeDesktop.LAN_ENDPOINT}/v2/lan/${FakeDesktop.PAIRING_ID}"), desktop.opened, "the local network answered; the relay was not needed")
            assertEquals(listOf(FakeDesktop.LAN_ENDPOINT), record.lanEndpoints)
            assertEquals(PairingPhase.Connecting(PairingVia.Lan), phases.first())

            desktop.lanReachable = false
            phases.clear()
            assertNotNull(flow(desktop).pairWithCode(invite))
            assertTrue(desktop.opened.last().startsWith("wss://relay.example/"), "the relay is the fallback")
            assertEquals(listOf(PairingVia.Lan, PairingVia.Relay), phases.filterIsInstance<PairingPhase.Connecting>().map { it.via })
            assertTrue(phases.last() is PairingPhase.Paired)
        }

    @Test
    fun aCodeWithNeitherAnAddressNorARelayIsNotUsable() =
        runTest {
            val desktop = FakeDesktop(backgroundScope)
            assertNull(flow(desktop).pairWithCode(desktop.invite(relay = null)))
            assertEquals(PairingPhase.Failed(PairingFailure.InvalidCode), phases.last())
            assertTrue(desktop.opened.isEmpty())
        }

    @Test
    fun aManualPairingShowsTheCodeAndTakesTheCredentialOnceAllowed() =
        runTest {
            val desktop = FakeDesktop(backgroundScope)
            val pairing = async { flow(desktop).pairManually("  ${FakeDesktop.LAN_ENDPOINT} ") }

            assertTrue(eventually { phases.lastOrNull() is PairingPhase.AwaitingApproval })
            assertEquals(listOf("ws://${FakeDesktop.LAN_ENDPOINT}${PairingFlow.MANUAL_PAIRING_PATH}"), desktop.opened)
            assertEquals(listOf<String?>(null), desktop.secrets, "a manual pairing has no secret yet")
            val expectedCode = RemoteCrypto.verificationCode(identity.publicKey, RemoteCrypto.decodePublicKey(desktop.identityKey))
            assertEquals(expectedCode, (phases.last() as PairingPhase.AwaitingApproval).verificationCode, "the same code the desktop shows")

            desktop.approveManual(name = "DEV-PC")
            val record = assertNotNull(pairing.await())
            assertEquals(desktop.identityKey, record.desktopIdentityKey, "the key learnt in the handshake is pinned from now on")
            assertEquals(FakeDesktop.PAIRING_ID, record.pairingId)
            assertEquals(FakeDesktop.MOBILE_SECRET, record.mobileSecret)
            assertEquals("DEV-PC", record.desktopName)
            assertEquals("wss://relay.example", record.relayBaseUrl)
            assertEquals(PairingPhase.Paired(record), phases.last())
        }

    @Test
    fun aDeclinedManualPairingSaysSo() =
        runTest {
            val desktop = FakeDesktop(backgroundScope)
            val pairing = async { flow(desktop).pairManually(FakeDesktop.LAN_ENDPOINT) }
            assertTrue(eventually { desktop.awaitingApproval != null })

            desktop.declineManual()
            assertNull(pairing.await())
            assertEquals(PairingPhase.Failed(PairingFailure.Rejected), phases.last())
        }

    @Test
    fun aMalformedAddressIsRefusedBeforeAnyConnection() =
        runTest {
            val desktop = FakeDesktop(backgroundScope)
            assertNull(flow(desktop).pairManually("192.168.1.20"))
            assertEquals(PairingPhase.Failed(PairingFailure.InvalidEndpoint), phases.last())
            assertTrue(desktop.opened.isEmpty())
        }

    @Test
    fun anUnreachableAddressTimesOut() =
        runTest {
            val desktop = FakeDesktop(backgroundScope)
            desktop.lanReachable = false
            assertNull(flow(desktop).pairManually(FakeDesktop.LAN_ENDPOINT))
            assertEquals(PairingPhase.Failed(PairingFailure.Unreachable), phases.last())
        }

    @Test
    fun aClosedSocketIsExplainedByItsReason() {
        assertEquals(PairingFailure.Rejected, PairingFlow.classify(null, "Pairing not approved"))
        assertEquals(PairingFailure.Unauthorized, PairingFlow.classify(null, "device not paired"))
        assertEquals(PairingFailure.Unauthorized, PairingFlow.classify(RemoteErrorCode.Unauthorized, null))
        assertEquals(PairingFailure.Unreachable, PairingFlow.classify(null, null))
    }
}
