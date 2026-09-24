package org.vetta.android.domain.remote

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import org.vetta.android.domain.remote.protocol.RemoteCrypto

const val PAIRING_URI_VERSION = 2

data class PairingInvite(
    val version: Int,
    val pairingId: String,
    val mobileSecret: String,
    val desktopIdentityKey: String,
    val desktopName: String,
    val lanEndpoints: List<String>,
    val relayBaseUrl: String?,
)

fun parsePairingInvite(value: String): PairingInvite? = runCatching {
    val uri = URI(value.trim())
    if (!uri.scheme.equals("vetta", ignoreCase = true) || !uri.host.equals("pair", ignoreCase = true)) error("scheme")
    val values = decodeQuery(uri.rawQuery.orEmpty())
    if (values["v"] != PAIRING_URI_VERSION.toString()) error("version")
    val pairingId = values["id"].orEmpty()
    val mobileSecret = values["s"].orEmpty()
    val desktopIdentityKey = values["k"].orEmpty()
    val desktopName = values["n"].orEmpty().trim()
    if (!pairingId.matches(ID_PATTERN) || !mobileSecret.matches(ID_PATTERN)) error("credentials")
    RemoteCrypto.decodePublicKey(desktopIdentityKey, "desktop identity key")
    if (desktopName.isEmpty() || desktopName.length > 128) error("desktop name")
    val lanEndpoints = values["lan"].orEmpty().split(',').map(String::trim).filter(String::isNotEmpty)
    if (lanEndpoints.any { !isValidHostPort(it) }) error("LAN endpoint")
    PairingInvite(
        version = PAIRING_URI_VERSION,
        pairingId = pairingId,
        mobileSecret = mobileSecret,
        desktopIdentityKey = desktopIdentityKey,
        desktopName = desktopName,
        lanEndpoints = lanEndpoints,
        relayBaseUrl = normalizeRelayBaseUrl(values["relay"]),
    )
}.getOrNull()

/** The relay socket a phone opens for the pairing `pairingId`. */
fun relayControlUrl(relayBaseUrl: String, pairingId: String): String =
    "$relayBaseUrl/v2/relay/${encodePathSegment(pairingId)}/mobile"

/** The desktop's local-network socket for the pairing `pairingId`. */
fun lanControlUrl(endpoint: String, pairingId: String): String = "ws://$endpoint/v2/lan/${encodePathSegment(pairingId)}"

/** The relay's screen-sharing viewer for a paired desktop. */
fun desktopViewerUrl(relayBaseUrl: String, pairingId: String, mobileSecret: String): String =
    "$relayBaseUrl/v2/desktop/${encodePathSegment(pairingId)}/viewer#pairing=${encode(mobileSecret)}"

fun normalizeRelayBaseUrl(value: String?): String? = runCatching {
    if (value.isNullOrBlank()) return null
    val uri = URI(value.trim())
    val scheme =
        when (uri.scheme?.lowercase()) {
            "http", "ws" -> "ws"
            "https", "wss" -> "wss"
            else -> return null
        }
    val authority = uri.rawAuthority?.takeIf(String::isNotBlank) ?: return null
    val path = uri.rawPath.orEmpty().trimEnd('/')
    "$scheme://$authority$path"
}.getOrNull()

fun isValidHostPort(value: String): Boolean {
    val match = HOST_PORT_PATTERN.matchEntire(value) ?: return false
    return match.groupValues[2].toIntOrNull() in 1..65_535
}

private fun decodeQuery(query: String): Map<String, String> {
    val result = linkedMapOf<String, String>()
    for (part in query.split('&').filter(String::isNotEmpty)) {
        val separator = part.indexOf('=')
        val key = decode(if (separator < 0) part else part.substring(0, separator))
        if (key in result) continue
        result[key] = decode(if (separator < 0) "" else part.substring(separator + 1))
    }
    return result
}

private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")

private fun encodePathSegment(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")

private fun decode(value: String): String = URLDecoder.decode(value, "UTF-8")

private val ID_PATTERN = Regex("^[A-Za-z0-9_-]{16,128}$")
private val HOST_PORT_PATTERN = Regex("^(\\[[0-9a-fA-F:.%a-zA-Z]+]|[A-Za-z0-9.-]+):(\\d{1,5})$")
