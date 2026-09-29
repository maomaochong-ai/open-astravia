package org.vetta.android.domain.remote

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class RemoteStreamStatsTest {
    private fun sample(jitterDelay: Double, jitterFrames: Double, decodeTime: Double, decoded: Double, local: String = "host", remote: String = "host") =
        listOf(
            RemoteStreamStats.Entry("L", "local-candidate", mapOf("candidateType" to local)),
            RemoteStreamStats.Entry("R", "remote-candidate", mapOf("candidateType" to remote)),
            RemoteStreamStats.Entry(
                "P",
                "candidate-pair",
                mapOf("nominated" to true, "state" to "succeeded", "currentRoundTripTime" to 0.008, "localCandidateId" to "L", "remoteCandidateId" to "R"),
            ),
            RemoteStreamStats.Entry(
                "V",
                "inbound-rtp",
                mapOf(
                    "kind" to "video",
                    "framesPerSecond" to 60.0,
                    "frameWidth" to 1920L,
                    "frameHeight" to 1080L,
                    "jitterBufferDelay" to jitterDelay,
                    "jitterBufferEmittedCount" to jitterFrames,
                    "totalDecodeTime" to decodeTime,
                    "framesDecoded" to decoded,
                ),
            ),
        )

    @Test
    fun readsTheRouteLatencyAndFrameRateAndAveragesTheLastSecond() {
        val (first, totals) = RemoteStreamStats.read(sample(1.0, 100.0, 0.5, 100.0), previous = null)
        assertEquals(RemoteStreamStats.Route.Lan, first.route)
        assertEquals(8.0, first.roundTripMs!!, 0.001)
        assertEquals(60.0, first.framesPerSecond)
        assertEquals(1920 to 1080, first.frameWidth to first.frameHeight)
        assertNull(first.jitterBufferMs, "a first sample has nothing to average against")

        val (second, _) = RemoteStreamStats.read(sample(2.2, 160.0, 0.8, 160.0), previous = totals)
        assertEquals(20.0, second.jitterBufferMs!!, 0.001)
        assertEquals(5.0, second.decodeMs!!, 0.001)
        assertEquals(4.0 + 20.0 + 5.0, second.pictureDelayMs!!, 0.001)
    }

    @Test
    fun tellsTheRouteFromTheCandidateTypes() {
        assertEquals(RemoteStreamStats.Route.Relayed, RemoteStreamStats.route("host", "relay"))
        assertEquals(RemoteStreamStats.Route.Internet, RemoteStreamStats.route("srflx", "host"))
        assertEquals(RemoteStreamStats.Route.Lan, RemoteStreamStats.route("host", "host"))
        assertNull(RemoteStreamStats.route(null, "host"))
    }
}
