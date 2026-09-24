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

data class MobileConnectionTarget(
    val url: String,
    val pairingSecret: String,
    val identitySecret: String,
    val desktopIdentityKey: String,
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

fun buildMobileRelayTarget(invite: PairingInvite, identitySecret: String): String? {
    RemoteCrypto.identityKeyPairFromSecret(RemoteCrypto.fromBase64Url(identitySecret))
    val relay = invite.relayBaseUrl ?: return null
    val fragment =
        listOf(
            "pairing" to invite.mobileSecret,
            "identity" to identitySecret,
            "peer" to invite.desktopIdentityKey,
        ).joinToString("&") { (key, value) -> "$key=${encode(value)}" }
    return "$relay/v2/relay/${invite.pairingId}/mobile#$fragment"
}

fun parseMobileConnectionTarget(value: String): MobileConnectionTarget? = runCatching {
    val separator = value.indexOf('#')
    if (separator <= 0) error("fragment")
    val url = value.substring(0, separator)
    val values = decodeQuery(value.substring(separator + 1))
    val pairingSecret = values["pairing"].orEmpty()
    val identitySecret = values["identity"].orEmpty()
    val desktopIdentityKey = values["peer"].orEmpty()
    if (!pairingSecret.matches(ID_PATTERN)) error("pairing secret")
    RemoteCrypto.identityKeyPairFromSecret(RemoteCrypto.fromBase64Url(identitySecret))
    RemoteCrypto.decodePublicKey(desktopIdentityKey, "desktop identity key")
    MobileConnectionTarget(url, pairingSecret, identitySecret, desktopIdentityKey)
}.getOrNull()

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

private fun decode(value: String): String = URLDecoder.decode(value, "UTF-8")

private val ID_PATTERN = Regex("^[A-Za-z0-9_-]{16,128}$")
private val HOST_PORT_PATTERN = Regex("^(\\[[0-9a-fA-F:.%a-zA-Z]+]|[A-Za-z0-9.-]+):(\\d{1,5})$")
