package org.vetta.android.domain.remote

/**
 * How the desktop's screen reaches the phone right now, from WebRTC's statistics, so a
 * slow picture can be told apart: a slow network, or a slow picture on a fast one (port
 * of the iPhone's `RemoteStreamStats`).
 */
data class RemoteStreamStats(
    val route: Route? = null,
    /** Network round trip of the WebRTC connection. */
    val roundTripMs: Double? = null,
    val framesPerSecond: Double? = null,
    val frameWidth: Int? = null,
    val frameHeight: Int? = null,
    /** How long a frame waits on the phone before it is shown, on average. */
    val jitterBufferMs: Double? = null,
    /** How long the phone takes to decode a frame, on average. */
    val decodeMs: Double? = null,
) {
    enum class Route {
        /** Both ends on the same network. */
        Lan,

        /** Straight between the two, across the internet. */
        Internet,

        /** Through a relay server. */
        Relayed,

        /** The selected local candidate uses a VPN interface. */
        Vpn,

        /** Direct, with insufficient evidence to establish network scope. */
        Direct,
    }

    /**
     * About how old the picture is when shown, beyond the desktop's own capture and
     * encoding, which the phone cannot see: half the round trip, the wait, the decode.
     */
    val pictureDelayMs: Double?
        get() = roundTripMs?.let { it / 2 + (jitterBufferMs ?: 0.0) + (decodeMs ?: 0.0) }

    /** One WebRTC statistics entry: its id, type ("candidate-pair", "inbound-rtp"…) and values. */
    data class Entry(val id: String, val type: String, val values: Map<String, Any?>)

    /** WebRTC's running totals for the received picture, to average over the last second only. */
    data class FrameTotals(val jitterDelay: Double, val jitterFrames: Double, val decodeTime: Double, val decodedFrames: Double, val streamId: String)

    companion object {
        /** Reads one sample; `previous` is the last sample's totals, for the per-frame averages. */
        fun read(entries: Collection<Entry>, previous: FrameTotals?, interfaces: List<RemoteNetworkInterface>): Pair<RemoteStreamStats, FrameTotals?> {
            val byId = entries.associateBy { it.id }

            fun number(entry: Entry?, key: String): Double? = (entry?.values?.get(key) as? Number)?.toDouble()?.takeIf { it.isFinite() }

            fun text(entry: Entry?, key: String): String? = entry?.values?.get(key) as? String
            var next = RemoteStreamStats()
            val video = entries.filter { it.type == "inbound-rtp" && text(it, "kind") == "video" }
                .maxByOrNull { number(it, "lastPacketReceivedTimestamp") ?: 0.0 }
            val transportId = text(video, "transportId")
            val transport = if (transportId != null) byId[transportId]
            else entries.filter { it.type == "transport" && text(it, "selectedCandidatePairId") != null }.singleOrNull()
            val pair = byId[text(transport, "selectedCandidatePairId")]
            if (transport?.type == "transport" &&
                (text(transport, "iceState") == null || text(transport, "iceState") in setOf("connected", "completed")) &&
                pair?.type == "candidate-pair" && text(pair, "state") == "succeeded"
            ) {
                next = next.copy(
                    roundTripMs = number(pair, "currentRoundTripTime")?.takeIf { it >= 0 }?.let { it * 1000 },
                    route = screenNetworkRoute(byId[text(pair, "localCandidateId")], byId[text(pair, "remoteCandidateId")], interfaces),
                )
            }
            if (video == null) return next to null
            val totals =
                FrameTotals(
                    jitterDelay = number(video, "jitterBufferDelay") ?: 0.0,
                    jitterFrames = number(video, "jitterBufferEmittedCount") ?: 0.0,
                    decodeTime = number(video, "totalDecodeTime") ?: 0.0,
                    decodedFrames = number(video, "framesDecoded") ?: 0.0,
                    streamId = video.id,
                )
            next =
                next.copy(
                    framesPerSecond = number(video, "framesPerSecond"),
                    frameWidth = number(video, "frameWidth")?.toInt(),
                    frameHeight = number(video, "frameHeight")?.toInt(),
                )
            if (previous != null && previous.streamId == totals.streamId) {
                val frames = totals.jitterFrames - previous.jitterFrames
                if (frames > 0 && totals.jitterDelay >= previous.jitterDelay) next = next.copy(jitterBufferMs = (totals.jitterDelay - previous.jitterDelay) / frames * 1000)
                val decoded = totals.decodedFrames - previous.decodedFrames
                if (decoded > 0 && totals.decodeTime >= previous.decodeTime) next = next.copy(decodeMs = (totals.decodeTime - previous.decodeTime) / decoded * 1000)
            }
            return next to totals
        }
    }
}
