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
    data class FrameTotals(val jitterDelay: Double, val jitterFrames: Double, val decodeTime: Double, val decodedFrames: Double)

    companion object {
        /** From the two ends' ICE candidate types ("host", "srflx", "prflx", "relay"). */
        fun route(local: String?, remote: String?): Route? {
            if (local == null || remote == null) return null
            if (local == "relay" || remote == "relay") return Route.Relayed
            if (local == "host" && remote == "host") return Route.Lan
            return Route.Internet
        }

        /** Reads one sample; `previous` is the last sample's totals, for the per-frame averages. */
        fun read(entries: Collection<Entry>, previous: FrameTotals?): Pair<RemoteStreamStats, FrameTotals?> {
            val byId = entries.associateBy { it.id }

            fun number(entry: Entry?, key: String): Double? = (entry?.values?.get(key) as? Number)?.toDouble()

            fun text(entry: Entry?, key: String): String? = entry?.values?.get(key) as? String
            var next = RemoteStreamStats()
            val pairs = entries.filter { it.type == "candidate-pair" && it.values["nominated"] == true }
            (pairs.firstOrNull { text(it, "state") == "succeeded" } ?: pairs.firstOrNull())?.let { pair ->
                next =
                    next.copy(
                        roundTripMs = number(pair, "currentRoundTripTime")?.let { it * 1000 },
                        route = route(text(byId[text(pair, "localCandidateId")], "candidateType"), text(byId[text(pair, "remoteCandidateId")], "candidateType")),
                    )
            }
            val video = entries.firstOrNull { it.type == "inbound-rtp" && text(it, "kind") == "video" } ?: return next to previous
            val totals =
                FrameTotals(
                    jitterDelay = number(video, "jitterBufferDelay") ?: 0.0,
                    jitterFrames = number(video, "jitterBufferEmittedCount") ?: 0.0,
                    decodeTime = number(video, "totalDecodeTime") ?: 0.0,
                    decodedFrames = number(video, "framesDecoded") ?: 0.0,
                )
            next =
                next.copy(
                    framesPerSecond = number(video, "framesPerSecond"),
                    frameWidth = number(video, "frameWidth")?.toInt(),
                    frameHeight = number(video, "frameHeight")?.toInt(),
                )
            if (previous != null) {
                val frames = totals.jitterFrames - previous.jitterFrames
                if (frames > 0) next = next.copy(jitterBufferMs = (totals.jitterDelay - previous.jitterDelay) / frames * 1000)
                val decoded = totals.decodedFrames - previous.decodedFrames
                if (decoded > 0) next = next.copy(decodeMs = (totals.decodeTime - previous.decodeTime) / decoded * 1000)
            }
            return next to totals
        }
    }
}
