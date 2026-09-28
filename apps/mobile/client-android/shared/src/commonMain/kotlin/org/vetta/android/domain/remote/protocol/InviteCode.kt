package org.vetta.android.domain.remote.protocol

import java.security.MessageDigest
import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.PKCS5S2ParametersGenerator
import org.bouncycastle.crypto.params.KeyParameter

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
