package org.vetta.android.domain.remote.protocol

import java.net.URLDecoder
import java.security.MessageDigest
import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.PKCS5S2ParametersGenerator
import org.bouncycastle.crypto.params.KeyParameter
import org.vetta.android.domain.remote.normalizeRelayBaseUrl

/**
 * Pairing with a connection code and password (port of `@vetta/remote-control`'s
 * `invite-code.ts`, ADR-0136): the desktop leaves its pairing link sealed under both on
 * the relay, in a mailbox named by a hash of the code; this phone fetches it and opens
 * it with the password. The two ends must agree byte for byte; a shared test vector
 * keeps them honest.
 */
object InviteCode {
    const val CODE_LENGTH = 8
    const val PASSWORD_LENGTH = 6
    const val KDF_ITERATIONS = 200_000
    const val ASSOCIATED_DATA = "vetta-invite-v1"

    /** The relay a desktop uses unless it was set up with its own. */
    const val DEFAULT_RELAY_BASE_URL = "wss://relay.flowerwine.dpdns.org"

    private const val ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    private const val BOX_ID_PREFIX = "vetta-invite-box-v1:"
    private const val KEY_SALT_PREFIX = "vetta-invite-key-v1:"

    data class Envelope(val nonce: String, val ciphertext: String)

    /**
     * What a desktop's pairing QR code holds once its connection code is on the relay
     * (ADR-0138): the code and password instead of the whole pairing link, so the code is
     * sparse enough to scan at a glance. The relay is named only when it is not the default.
     */
    data class Qr(val code: String, val password: String, val relayBaseUrl: String? = null)

    private const val QR_PREFIX = "VETTA://PAIR/"

    /**
     * The code, password and relay in a scanned QR code; null for anything else, such as a
     * whole pairing link. Mirrors `parseInviteQr` in `@vetta/remote-control`.
     */
    fun parseQr(text: String): Qr? {
        val trimmed = text.trim()
        if (!trimmed.uppercase().startsWith(QR_PREFIX)) return null
        val rest = trimmed.substring(QR_PREFIX.length)
        val path = rest.substringBefore('?').split('/')
        if (path.size != 2) return null
        val code = normalize(path[0]) ?: return null
        val password = path[1].takeIf(::isValidPassword) ?: return null
        var relay: String? = null
        if ('?' in rest) {
            for (item in rest.substringAfter('?').split('&')) {
                if (!item.startsWith("relay=")) continue
                val value = runCatching { URLDecoder.decode(item.removePrefix("relay="), "UTF-8") }.getOrNull() ?: return null
                if (!value.lowercase().startsWith("ws://") && !value.lowercase().startsWith("wss://")) return null
                relay = normalizeRelayBaseUrl(value) ?: return null
            }
        }
        return Qr(code, password, relay)
    }

    /**
     * What typing or pasting into the code boxes leaves: capitals, the look-alike letters
     * read as digits, anything else dropped, at most eight.
     */
    fun typed(input: String): String =
        input
            .uppercase()
            .mapNotNull { char ->
                when (char) {
                    'O' -> '0'
                    'I', 'L' -> '1'
                    else -> char.takeIf { it in ALPHABET }
                }
            }.take(CODE_LENGTH)
            .joinToString("")

    /** "K7Q29MXD" → "K7Q2-9MXD", as the computer shows it; shorter input is left as it is. */
    fun format(code: String): String = if (code.length > 4) "${code.take(4)}-${code.drop(4)}" else code

    /** What was typed, as the code it names; null when it cannot be one. */
    fun normalize(input: String): String? {
        val code =
            input
                .uppercase()
                .filterNot { it.isWhitespace() || it == '-' }
                .replace('O', '0')
                .replace('I', '1')
                .replace('L', '1')
        return code.takeIf { it.length == CODE_LENGTH && it.all(ALPHABET::contains) }
    }

    fun isValidPassword(password: String): Boolean = password.length == PASSWORD_LENGTH && password.all { it in '0'..'9' }

    fun boxId(code: String): String =
        RemoteCrypto.toBase64Url(MessageDigest.getInstance("SHA-256").digest("$BOX_ID_PREFIX$code".encodeToByteArray()))

    fun boxUrl(relayBaseUrl: String, code: String): String =
        "${relayBaseUrl.trimEnd('/').replaceFirst(Regex("^ws(s?):"), "http$1:")}/v2/invite/${boxId(code)}"

    /** The pairing link inside; throws [RemoteProtocolException] when the password (or code) is wrong. */
    fun open(envelope: Envelope, code: String, password: String): String {
        val plaintext =
            try {
                RemoteCrypto.xchacha(
                    false,
                    key(code, password),
                    RemoteCrypto.fromBase64Url(envelope.nonce),
                    RemoteCrypto.fromBase64Url(envelope.ciphertext),
                    ASSOCIATED_DATA,
                )
            } catch (error: Throwable) {
                throw RemoteProtocolException("invite failed authentication", error)
            }
        return plaintext.decodeToString()
    }

    /** What the desktop does; here for tests. */
    internal fun seal(uri: String, code: String, password: String, nonce: ByteArray): Envelope =
        Envelope(
            RemoteCrypto.toBase64Url(nonce),
            RemoteCrypto.toBase64Url(RemoteCrypto.xchacha(true, key(code, password), nonce, uri.encodeToByteArray(), ASSOCIATED_DATA)),
        )

    private fun key(code: String, password: String): ByteArray {
        val generator = PKCS5S2ParametersGenerator(SHA256Digest())
        generator.init(password.encodeToByteArray(), "$KEY_SALT_PREFIX$code".encodeToByteArray(), KDF_ITERATIONS)
        return (generator.generateDerivedMacParameters(256) as KeyParameter).key
    }
}
