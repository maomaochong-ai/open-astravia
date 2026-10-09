package org.vetta.android.domain.remote

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RemoteStreamStatsTest {
    private val wifi = listOf(RemoteNetworkInterface("192.168.16.2", 20))

    private fun sample(
        jitterDelay: Double = 1.0, jitterFrames: Double = 100.0, decodeTime: Double = 0.5,
        local: Map<String, Any?> = mapOf("candidateType" to "host", "address" to "192.168.16.2", "networkType" to "wifi"),
        remote: Map<String, Any?> = mapOf("candidateType" to "host", "address" to "192.168.31.200"),
    ) = listOf(
        RemoteStreamStats.Entry("L", "local-candidate", local),
        RemoteStreamStats.Entry("R", "remote-candidate", remote),
        RemoteStreamStats.Entry("P", "candidate-pair", mapOf("nominated" to true, "state" to "succeeded", "currentRoundTripTime" to 0.008, "localCandidateId" to "L", "remoteCandidateId" to "R")),
        RemoteStreamStats.Entry("T", "transport", mapOf("selectedCandidatePairId" to "P", "iceState" to "connected")),
        RemoteStreamStats.Entry("V", "inbound-rtp", mapOf("kind" to "video", "transportId" to "T", "framesPerSecond" to 60.0, "frameWidth" to 1920L, "frameHeight" to 1080L,
            "jitterBufferDelay" to jitterDelay, "jitterBufferEmittedCount" to jitterFrames, "totalDecodeTime" to decodeTime, "framesDecoded" to jitterFrames)),
    )

    private data class RouteCase(val network: String, val local: String, val remote: String, val interfaceAddress: String, val prefix: Int, val route: RemoteStreamStats.Route)

    @Test
    fun classifiesTheSelectedAddressAndInterfaceInsteadOfHostCandidateType() {
        val cases = listOf(
            RouteCase("wifi", "192.168.16.2", "192.168.31.200", "192.168.16.2", 20, RemoteStreamStats.Route.Lan),
            RouteCase("wifi", "192.168.16.2", "192.168.32.1", "192.168.16.2", 20, RemoteStreamStats.Route.Direct),
            RouteCase("ethernet", "192.168.16.2", "203.0.113.8", "192.168.16.2", 20, RemoteStreamStats.Route.Internet),
            RouteCase("cellular", "2001:db8:1::2", "2001:db8:2::3", "2001:db8:1::2", 64, RemoteStreamStats.Route.Internet),
            RouteCase("cellular", "10.1.2.3", "10.1.2.4", "10.1.2.3", 24, RemoteStreamStats.Route.Internet),
            RouteCase("wifi", "2001:db8:1::2", "2001:0db8:0001:0:0:0:0:3", "2001:db8:1::2", 64, RemoteStreamStats.Route.Lan),
            RouteCase("wifi", "2001:db8:1::2", "2001:db8:2::3", "2001:db8:1::2", 64, RemoteStreamStats.Route.Internet),
            RouteCase("wifi", "fe80::2", "fe80::3", "fe80::2%wlan0", 64, RemoteStreamStats.Route.Lan),
            RouteCase("wifi", "::ffff:192.168.16.2", "::ffff:192.168.31.200", "192.168.16.2", 20, RemoteStreamStats.Route.Lan),
            RouteCase("vpn", "10.1.2.3", "10.1.2.4", "10.1.2.3", 24, RemoteStreamStats.Route.Vpn),
            RouteCase("unknown", "192.168.16.2", "192.168.31.200", "192.168.16.2", 20, RemoteStreamStats.Route.Direct),
            RouteCase("wifi", "192.168.16.2", "peer.local", "192.168.16.2", 20, RemoteStreamStats.Route.Direct),
            RouteCase("wifi", "192.168.16.2", "203.0.113.8", "192.168.16.2", 0, RemoteStreamStats.Route.Direct),
        )
        for (case in cases) {
            val report = sample(local = mapOf("candidateType" to "host", "address" to case.local, "networkType" to case.network),
                remote = mapOf("candidateType" to "host", "address" to case.remote))
            assertEquals(case.route, RemoteStreamStats.read(report, null, listOf(RemoteNetworkInterface(case.interfaceAddress, case.prefix))).first.route, "network=${case.network}")
        }
        assertEquals(RemoteStreamStats.Route.Direct, RemoteStreamStats.read(sample(), null, emptyList()).first.route)
    }

    @Test
    fun usesNatBaseAddressAndVpnEvidenceAndRecognizesRelay() {
        val local = mapOf("candidateType" to "srflx", "address" to "198.51.100.2", "relatedAddress" to "192.168.16.2", "networkType" to "wifi")
        assertEquals(RemoteStreamStats.Route.Internet, RemoteStreamStats.read(sample(local = local, remote = mapOf("candidateType" to "host", "address" to "203.0.113.8")), null, wifi).first.route)
        assertEquals(RemoteStreamStats.Route.Direct, RemoteStreamStats.read(sample(local = local, remote = mapOf("candidateType" to "srflx", "address" to "198.51.100.2")), null, wifi).first.route)
        assertEquals(RemoteStreamStats.Route.Vpn, RemoteStreamStats.read(sample(local = mapOf("candidateType" to "host", "networkAdapterType" to "wifi", "vpn" to true)), null, wifi).first.route)
        assertEquals(RemoteStreamStats.Route.Vpn, RemoteStreamStats.read(sample(), null, listOf(RemoteNetworkInterface("192.168.16.2", 20, true))).first.route)
        assertEquals(RemoteStreamStats.Route.Relayed, RemoteStreamStats.read(sample(local = mapOf("candidateType" to "relay")), null, wifi).first.route)
        assertEquals(RemoteStreamStats.Route.Relayed, RemoteStreamStats.read(sample(remote = mapOf("candidateType" to "relay")), null, wifi).first.route)
    }

    @Test
    fun followsTheVideoTransportThroughLanCellularVpnAndDisconnect() {
        val (first, totals) = RemoteStreamStats.read(sample(), null, wifi)
        assertEquals(RemoteStreamStats.Route.Lan, first.route)
        var report = sample().filter { it.id != "T" } + listOf(
            RemoteStreamStats.Entry("OldTransport", "transport", mapOf("selectedCandidatePairId" to "P")),
            RemoteStreamStats.Entry("L2", "local-candidate", mapOf("candidateType" to "host", "networkType" to "cellular", "address" to "2001:db8:1::1")),
            RemoteStreamStats.Entry("P2", "candidate-pair", mapOf("state" to "succeeded", "localCandidateId" to "L2", "remoteCandidateId" to "R", "currentRoundTripTime" to 0.045)),
            RemoteStreamStats.Entry("T", "transport", mapOf("selectedCandidatePairId" to "P2", "iceState" to "connected")),
        )
        val second = RemoteStreamStats.read(report.reversed(), totals, wifi).first
        assertEquals(RemoteStreamStats.Route.Internet, second.route)
        assertEquals(45.0, second.roundTripMs)
        report = report.map { if (it.id == "L2") RemoteStreamStats.Entry("L2", "local-candidate", mapOf("candidateType" to "host", "vpn" to true)) else it }
        assertEquals(RemoteStreamStats.Route.Vpn, RemoteStreamStats.read(report, null, wifi).first.route)
        for (values in listOf(emptyMap(), mapOf("selectedCandidatePairId" to "missing"), mapOf("selectedCandidatePairId" to "P2", "iceState" to "disconnected"))) {
            val changed = report.map { if (it.id == "T") RemoteStreamStats.Entry("T", "transport", values) else it }
            val stats = RemoteStreamStats.read(changed, null, wifi).first
            assertNull(stats.route)
            assertNull(stats.roundTripMs, "do not use an old nominated pair when selection disappears")
        }
    }

    @Test
    fun readsFrameStatisticsAndResetsAveragesOnCounterReset() {
        val (first, totals) = RemoteStreamStats.read(sample(), null, wifi)
        assertEquals(8.0, first.roundTripMs!!, 0.001)
        assertEquals(60.0, first.framesPerSecond)
        assertEquals(1920 to 1080, first.frameWidth to first.frameHeight)
        assertNull(first.jitterBufferMs)
        val (second, nextTotals) = RemoteStreamStats.read(sample(2.2, 160.0, 0.8), totals, wifi)
        assertEquals(20.0, second.jitterBufferMs!!, 0.001)
        assertEquals(5.0, second.decodeMs!!, 0.001)
        assertEquals(29.0, second.pictureDelayMs!!, 0.001)
        val reset = RemoteStreamStats.read(sample(0.1, 1.0, 0.1), nextTotals, wifi).first
        assertNull(reset.jitterBufferMs)
        assertNull(reset.decodeMs)
    }

    @Test
    fun parsesNumericAddressesWithoutDnsAndMatchesActualPrefixes() {
        for (address in listOf("", "example.com", "1.2.3.999", "2001:::1", "::1", "ff02::1", "0.0.0.0", "127.0.0.1")) {
            assertTrue(NumericIp.parse(address)?.isUnicast != true)
        }
        assertEquals(NumericIp.parse("192.168.1.2"), NumericIp.parse("::ffff:192.168.1.2"))
        assertEquals(NumericIp.parse("2001:db8::1"), NumericIp.parse("2001:0db8:0:0:0:0:0:1"))
    }

    @Test
    fun neverGuessesFromUnselectedFailedOrAmbiguousCandidates() {
        val original = sample()
        for (report in listOf(
            original.filter { it.id != "T" },
            original.filter { it.id != "P" },
            original.map { if (it.id == "P") RemoteStreamStats.Entry("P", "candidate-pair", mapOf("state" to "failed", "nominated" to true)) else it },
            original.filter { it.id != "V" } + RemoteStreamStats.Entry("T2", "transport", mapOf("selectedCandidatePairId" to "P")),
        )) {
            val stats = RemoteStreamStats.read(report, null, wifi).first
            assertNull(stats.route)
            assertNull(stats.roundTripMs)
        }
        assertEquals(RemoteStreamStats.Route.Lan, RemoteStreamStats.read(original.filter { it.id != "V" }, null, wifi).first.route)
        assertEquals(RemoteStreamStats.Route.Direct, RemoteStreamStats.read(original, null, listOf(RemoteNetworkInterface("192.168.99.2", 24))).first.route)
        assertEquals(RemoteStreamStats.Route.Direct, RemoteStreamStats.read(original, null, wifi + RemoteNetworkInterface("192.168.16.2", 20, true)).first.route)
        assertEquals(RemoteStreamStats.Route.Internet, RemoteStreamStats.read(sample(local = mapOf("candidateType" to "host", "networkType" to "unknown", "networkAdapterType" to "cellular5g")), null, wifi).first.route)
        assertNull(RemoteStreamStats.read(sample(local = mapOf("candidateType" to "unknown")), null, wifi).first.route)
    }
}
