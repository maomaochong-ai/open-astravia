package org.vetta.android.domain.remote.link

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.vetta.android.domain.remote.pairing.DesktopRecord
import org.vetta.android.domain.remote.protocol.RemoteCrypto
import org.vetta.android.domain.remote.protocol.RemoteEventName
import org.vetta.android.domain.remote.protocol.RemoteRequestMethod
import org.vetta.android.domain.work.FakeDesktop
import org.vetta.android.domain.work.eventually
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class LinkIndicatorTest {
    @Test
    fun followsTheLinkThroughAReconnect() {
        assertEquals(LinkIndicator.Connecting, LinkIndicator.of(LinkSnapshot.Offline), "before the first attempt nothing has failed yet")
        assertEquals(LinkIndicator.Connecting, LinkIndicator.of(LinkSnapshot(LinkStatus.Connecting)))
        assertEquals(LinkIndicator.Online, LinkIndicator.of(LinkSnapshot(LinkStatus.Online, peerOnline = true)))
        assertEquals(LinkIndicator.Offline, LinkIndicator.of(LinkSnapshot(LinkStatus.Offline, reconnectAttempt = 1, lastError = "closed")))
        assertEquals(LinkIndicator.Reconnecting(1), LinkIndicator.of(LinkSnapshot(LinkStatus.Connecting, reconnectAttempt = 1, lastError = "closed")))
    }

    @Test
    fun treatsARelayWithoutTheDesktopAsOffline() {
        assertEquals(LinkIndicator.Offline, LinkIndicator.of(LinkSnapshot(LinkStatus.Online, peerOnline = false)))
    }
}

class DesktopLinkTest {
    private fun TestScope.link(desktop: FakeDesktop, lastEventSequence: Long = 0, relay: String? = "wss://relay.example", onSequence: (Long) -> Unit = {}): DesktopLink =
        DesktopLink(
            DesktopLinkOptions(
                desktop =
                    DesktopRecord(
                        desktopIdentityKey = desktop.identityKey,
                        desktopName = "MacBook Pro",
                        pairingId = FakeDesktop.PAIRING_ID,
                        mobileSecret = FakeDesktop.MOBILE_SECRET,
                        lanEndpoints = emptyList(),
                        relayBaseUrl = relay,
                        lastEventSequence = lastEventSequence,
                    ),
                identity = RemoteCrypto.generateIdentityKeyPair(),
                deviceId = "phone-1",
                deviceName = "Pixel",
                createTransport = desktop.createTransport,
                now = { testScheduler.currentTime },
                onSequence = onSequence,
            ),
            backgroundScope,
        )

    @Test
    fun comesOnlineOverTheRelayAndSamplesTheDesktop() =
        runTest {
            val desktop = FakeDesktop(backgroundScope)
            desktop.handler = { request ->
                respond(
                    request.requestId,
                    if (request.method == RemoteRequestMethod.DiagnosticsSnapshot) {
                        buildJsonObject {
                            put("osLabel", "macOS 26")
                            put("cpu", "M4")
                            put("ram", "32 GB")
                        }
                    } else {
                        buildJsonObject {}
                    },
                )
            }
            val link = link(desktop)
            link.start()
            assertTrue(eventually { link.snapshot.value.isUsable })
            assertEquals(LinkChannel.Relay, link.snapshot.value.channel)
            assertEquals(listOf("wss://relay.example/v2/relay/${FakeDesktop.PAIRING_ID}/mobile"), desktop.opened)
            assertTrue(eventually { link.snapshot.value.diagnostics == DesktopDiagnostics("macOS 26", "M4", "32 GB") })
            assertTrue(link.snapshot.value.onlineSince != null)
        }

    @Test
    fun reconnectsWithBackoffAndResumesAfterTheLastEvent() =
        runTest {
            val desktop = FakeDesktop(backgroundScope)
            val sequences = mutableListOf<Long>()
            val link = link(desktop, onSequence = { sequences += it })
            val seen = mutableListOf<Long>()
            backgroundScope.launchCollect(link) { seen += it }
            link.start()
            assertTrue(eventually { link.snapshot.value.isUsable })
            desktop.emit(RemoteEventName.SessionState, buildJsonObject { put("status", "running") }, "s1")
            assertTrue(eventually { seen == listOf(1L) })

            desktop.reachable = false
            desktop.dropConnections()
            assertTrue(eventually { LinkIndicator.of(link.snapshot.value) == LinkIndicator.Offline })
            assertTrue(eventually(timeoutMs = 20_000) { link.snapshot.value.reconnectAttempt >= 2 }, "keeps retrying while the desktop is away")
            desktop.journalWhileAway(RemoteEventName.SessionState, buildJsonObject { put("status", "completed") }, "s1")

            desktop.reachable = true
            link.refresh()
            assertTrue(eventually { link.snapshot.value.isUsable }, "refresh reconnects without waiting out the backoff")
            assertEquals(0, link.snapshot.value.reconnectAttempt)
            assertTrue(eventually { seen == listOf(1L, 2L) }, "the missed event arrives once, the seen one is not replayed")
            assertEquals(listOf(1L, 2L), sequences)
        }

    @Test
    fun reportsAPairingTheDesktopNoLongerAccepts() =
        runTest {
            val desktop = FakeDesktop(backgroundScope)
            desktop.rejectUnauthorized = true
            val link = link(desktop)
            link.start()
            assertTrue(eventually { link.snapshot.value.reconnectAttempt >= 1 })
            assertEquals(LinkIndicator.Offline, LinkIndicator.of(link.snapshot.value))
        }

    @Test
    fun refusesRequestsWhileOffline() =
        runTest {
            val link = link(FakeDesktop(backgroundScope), relay = null)
            link.start()
            assertFailsWith<LinkOfflineException> { link.request(RemoteRequestMethod.SessionList) }
            assertTrue(eventually { link.snapshot.value.lastError == "unreachable" }, "a desktop without a relay cannot be reached yet")
        }

    @Test
    fun keepsTheLanEndpointsTheDesktopAnnounces() =
        runTest {
            val desktop = FakeDesktop(backgroundScope)
            val link = link(desktop)
            link.start()
            assertTrue(eventually { link.snapshot.value.isUsable })
            desktop.emit(
                RemoteEventName.DeviceStatus,
                buildJsonObject {
                    put("deviceName", "MacBook Pro")
                    put("lanEndpoints", buildJsonArray { add(JsonPrimitive("10.0.0.2:43117")) })
                    put("runningSessionCount", 2)
                },
            )
            assertTrue(eventually { link.snapshot.value.desktop?.runningSessionCount == 2 })
            assertEquals(listOf("10.0.0.2:43117"), link.snapshot.value.desktop?.lanEndpoints)
        }

    private fun CoroutineScope.launchCollect(link: DesktopLink, onSequence: (Long) -> Unit) {
        launch(start = CoroutineStart.UNDISPATCHED) { link.events.collect { onSequence(it.sequence) } }
    }
}
