package org.vetta.android.domain.remote

data class PairingInvite(val relayBaseUrl: String, val pairingId: String, val bootstrapSecret: String)

fun parsePairingInvite(value: String): PairingInvite? {
    val match = Regex("^vetta://pair\\?(.+)$").matchEntire(value.trim()) ?: return null
    val values = match.groupValues[1].split('&').mapNotNull {
        val separator = it.indexOf('=')
        if (separator <= 0) null else decode(it.substring(0, separator)) to decode(it.substring(separator + 1))
    }.toMap()
    val relay = values["relay"]?.trimEnd('/') ?: return null
    val pairingId = values["pairingId"] ?: return null
    val bootstrap = values["bootstrap"] ?: return null
    if (!relay.startsWith("https://") && !relay.startsWith("http://")) return null
    if (!pairingId.matches(Regex("[A-Za-z0-9_-]{24,128}"))) return null
    if (!bootstrap.matches(Regex("[A-Za-z0-9_-]{32,256}"))) return null
    return PairingInvite(relay, pairingId, bootstrap)
}

fun buildMobileBootstrapTarget(invite: PairingInvite, resumeSecret: String): String {
    val socketBase = invite.relayBaseUrl.replaceFirst("https://", "wss://").replaceFirst("http://", "ws://")
    return "$socketBase/v1/relay/${invite.pairingId}/mobile#pairing=${encode(invite.bootstrapSecret)}&resume=${encode(resumeSecret)}"
}

fun buildMobileResumeTarget(invite: PairingInvite, resumeSecret: String): String {
    val socketBase = invite.relayBaseUrl.replaceFirst("https://", "wss://").replaceFirst("http://", "ws://")
    return "$socketBase/v1/relay/${invite.pairingId}/mobile#pairing=${encode(resumeSecret)}"
}

private fun encode(value: String): String = java.net.URLEncoder.encode(value, "UTF-8")
private fun decode(value: String): String = java.net.URLDecoder.decode(value, "UTF-8")
