package org.vetta.android.domain.remote

/** In-memory interface evidence, never included in logs or persisted. */
data class RemoteNetworkInterface(val address: String, val prefixLength: Int, val isTunnel: Boolean = false)

/** Port of VettaKit's route classifier. Candidate type alone says nothing about LAN scope. */
internal fun screenNetworkRoute(
    local: RemoteStreamStats.Entry?,
    remote: RemoteStreamStats.Entry?,
    interfaces: List<RemoteNetworkInterface>,
): RemoteStreamStats.Route? {
    fun text(entry: RemoteStreamStats.Entry?, key: String) = entry?.values?.get(key) as? String
    val localType = text(local, "candidateType")
    val remoteType = text(remote, "candidateType")
    if (localType == "relay" || remoteType == "relay") return RemoteStreamStats.Route.Relayed
    val directTypes = setOf("host", "srflx", "prflx")
    if (local == null || remote == null || localType !in directTypes || remoteType !in directTypes) return null
    val network = listOfNotNull(text(local, "networkType"), text(local, "networkAdapterType"))
    if (local.values["vpn"] == true || "vpn" in network) return RemoteStreamStats.Route.Vpn
    val base = NumericIp.parse(if (localType == "host") text(local, "address") ?: text(local, "ip") else text(local, "relatedAddress"))
    val matches = interfaces.filter { base != null && NumericIp.parse(it.address) == base }
    if (matches.singleOrNull()?.isTunnel == true) return RemoteStreamStats.Route.Vpn
    if (network.any { it in setOf("cellular", "cellular2g", "cellular3g", "cellular4g", "cellular5g") }) return RemoteStreamStats.Route.Internet
    val destination = NumericIp.parse(text(remote, "address") ?: text(remote, "ip"))
    if (network.none { it == "wifi" || it == "ethernet" } || matches.size != 1 || base == null || destination == null) return RemoteStreamStats.Route.Direct
    if (localType != "host" && destination == NumericIp.parse(text(local, "address") ?: text(local, "ip"))) return RemoteStreamStats.Route.Direct
    val prefix = matches.single().prefixLength
    if (prefix <= 0 || prefix > base.bytes.size * 8) return RemoteStreamStats.Route.Direct
    if (destination.isUnicast && base.contains(destination, prefix)) return RemoteStreamStats.Route.Lan
    if (destination.isGlobal) return RemoteStreamStats.Route.Internet
    // Off-prefix private addresses can belong to routed LANs or tunnels.
    return RemoteStreamStats.Route.Direct
}

/** Numeric literals only: classification must never trigger a DNS lookup. */
internal data class NumericIp(val bytes: List<Int>) {
    fun contains(other: NumericIp, prefix: Int): Boolean {
        if (bytes.size != other.bytes.size || prefix <= 0 || prefix > bytes.size * 8) return false
        return (0 until prefix).all { bit ->
            val mask = 1 shl (7 - bit % 8)
            (bytes[bit / 8] and mask) == (other.bytes[bit / 8] and mask)
        }
    }

    val isUnicast: Boolean
        get() = if (bytes.size == 4) bytes[0] != 0 && bytes[0] != 127 && bytes[0] < 224
        else bytes.any { it != 0 } && bytes != List(15) { 0 } + 1 && bytes[0] != 255

    val isGlobal: Boolean
        get() {
            if (!isUnicast) return false
            if (bytes.size == 16) return (bytes[0] and 0xe0) == 0x20
            return !(bytes[0] == 10 || (bytes[0] == 172 && bytes[1] in 16..31) ||
                (bytes[0] == 192 && bytes[1] == 168) || (bytes[0] == 169 && bytes[1] == 254) ||
                (bytes[0] == 100 && bytes[1] in 64..127) || (bytes[0] == 198 && bytes[1] in 18..19))
        }

    companion object {
        fun parse(text: String?): NumericIp? {
            val literal = text?.substringBefore('%')?.takeIf { it.isNotEmpty() } ?: return null
            if (':' !in literal) return ipv4(literal)?.let(::NumericIp)
            if (literal.indexOf("::") != literal.lastIndexOf("::")) return null
            val halves = literal.split("::", limit = 2)
            fun words(part: String): List<Int>? {
                if (part.isEmpty()) return emptyList()
                val result = mutableListOf<Int>()
                val pieces = part.split(':')
                for ((index, piece) in pieces.withIndex()) {
                    if ('.' in piece) {
                        if (index != pieces.lastIndex) return null
                        val v4 = ipv4(piece) ?: return null
                        result += (v4[0] shl 8) + v4[1]
                        result += (v4[2] shl 8) + v4[3]
                    } else {
                        if (piece.length !in 1..4 || piece.any { it !in "0123456789abcdefABCDEF" }) return null
                        result += piece.toInt(16)
                    }
                }
                return result
            }
            val left = words(halves[0]) ?: return null
            val right = if (halves.size == 2) words(halves[1]) ?: return null else emptyList()
            val missing = 8 - left.size - right.size
            if ((halves.size == 1 && missing != 0) || (halves.size == 2 && missing < 1)) return null
            if (halves.size == 2 && '.' in halves[0]) return null
            val bytes = (left + List(missing) { 0 } + right).flatMap { listOf(it shr 8, it and 255) }
            return NumericIp(if (bytes.take(10).all { it == 0 } && bytes[10] == 255 && bytes[11] == 255) bytes.takeLast(4) else bytes)
        }

        private fun ipv4(text: String): List<Int>? {
            val parts = text.split('.')
            if (parts.size != 4) return null
            return parts.map { part ->
                if (part.isEmpty() || part.length > 3 || part.any { it !in '0'..'9' } || (part.length > 1 && part[0] == '0')) return null
                part.toIntOrNull()?.takeIf { it in 0..255 } ?: return null
            }
        }
    }
}
