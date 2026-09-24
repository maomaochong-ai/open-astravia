package org.vetta.android.domain.remote.protocol

import java.security.MessageDigest
import java.security.SecureRandom
import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.HKDFBytesGenerator
import org.bouncycastle.crypto.modes.ChaCha20Poly1305
import org.bouncycastle.crypto.params.AEADParameters
import org.bouncycastle.crypto.params.HKDFParameters
import org.bouncycastle.crypto.params.KeyParameter
import org.bouncycastle.crypto.params.X25519PrivateKeyParameters
import org.bouncycastle.crypto.params.X25519PublicKeyParameters
import org.bouncycastle.util.encoders.Base64

data class RemoteIdentityKeyPair(
    val secretKey: ByteArray,
    val publicKey: ByteArray,
) {
    override fun equals(other: Any?): Boolean =
        other is RemoteIdentityKeyPair &&
            secretKey.contentEquals(other.secretKey) &&
            publicKey.contentEquals(other.publicKey)

    override fun hashCode(): Int = 31 * secretKey.contentHashCode() + publicKey.contentHashCode()
}

data class RemoteSessionKeys(
    val sendKey: ByteArray,
    val receiveKey: ByteArray,
) {
    override fun equals(other: Any?): Boolean =
        other is RemoteSessionKeys && sendKey.contentEquals(other.sendKey) && receiveKey.contentEquals(other.receiveKey)

    override fun hashCode(): Int = 31 * sendKey.contentHashCode() + receiveKey.contentHashCode()
}

object RemoteCrypto {
    const val SEALED_ASSOCIATED_DATA = "vetta-remote-v2"
    private const val KEY_LENGTH = 32
    private const val NONCE_LENGTH = 24
    private const val INFO_PREFIX = "vetta-remote-v2"
    private val secureRandom = SecureRandom()

    fun randomBytes(length: Int): ByteArray = ByteArray(length).also(secureRandom::nextBytes)

    fun generateIdentityKeyPair(randomBytes: (Int) -> ByteArray = ::randomBytes): RemoteIdentityKeyPair =
        identityKeyPairFromSecret(randomBytes(KEY_LENGTH))

    fun identityKeyPairFromSecret(secretKey: ByteArray): RemoteIdentityKeyPair {
        if (secretKey.size != KEY_LENGTH) throw RemoteProtocolException("identity secret must be 32 bytes")
        val privateKey = X25519PrivateKeyParameters(secretKey, 0)
        return RemoteIdentityKeyPair(secretKey.copyOf(), privateKey.generatePublicKey().encoded)
    }

    fun deriveSessionKeys(
        role: RemoteRole,
        identity: RemoteIdentityKeyPair,
        ephemeral: RemoteIdentityKeyPair,
        peerIdentityKey: ByteArray,
        peerEphemeralKey: ByteArray,
    ): RemoteSessionKeys {
        val ephemeralShared = sharedSecret(ephemeral.secretKey, peerEphemeralKey)
        val staticToPeerEphemeral = sharedSecret(identity.secretKey, peerEphemeralKey)
        val ephemeralToPeerStatic = sharedSecret(ephemeral.secretKey, peerIdentityKey)
        val mobileFirst = role == RemoteRole.Mobile
        val ikm = concat(
            ephemeralShared,
            if (mobileFirst) staticToPeerEphemeral else ephemeralToPeerStatic,
            if (mobileFirst) ephemeralToPeerStatic else staticToPeerEphemeral,
        )
        val salt =
            if (mobileFirst) {
                concat(identity.publicKey, peerIdentityKey, ephemeral.publicKey, peerEphemeralKey)
            } else {
                concat(peerIdentityKey, identity.publicKey, peerEphemeralKey, ephemeral.publicKey)
            }
        val material = hkdf(ikm, salt, "$INFO_PREFIX/session".encodeToByteArray(), KEY_LENGTH * 2)
        val mobileToDesktop = material.copyOfRange(0, KEY_LENGTH)
        val desktopToMobile = material.copyOfRange(KEY_LENGTH, KEY_LENGTH * 2)
        return if (mobileFirst) {
            RemoteSessionKeys(mobileToDesktop, desktopToMobile)
        } else {
            RemoteSessionKeys(desktopToMobile, mobileToDesktop)
        }
    }

    fun sealFrame(
        key: ByteArray,
        frame: RemoteSessionFrame,
        associatedData: String = SEALED_ASSOCIATED_DATA,
        randomBytes: (Int) -> ByteArray = ::randomBytes,
    ): RemoteSealed {
        val nonce = randomBytes(NONCE_LENGTH)
        val ciphertext = xchacha(true, key, nonce, RemoteProtocol.encodeSession(frame).encodeToByteArray(), associatedData)
        return RemoteSealed(toBase64Url(nonce), toBase64Url(ciphertext))
    }

    fun openFrame(
        key: ByteArray,
        sealed: RemoteSealed,
        associatedData: String = SEALED_ASSOCIATED_DATA,
    ): RemoteSessionFrame {
        val plaintext =
            try {
                xchacha(false, key, fromBase64Url(sealed.nonce), fromBase64Url(sealed.ciphertext), associatedData)
            } catch (error: Throwable) {
                throw RemoteProtocolException("sealed frame failed authentication", error)
            }
        return try {
            RemoteProtocol.decodeSession(plaintext.decodeToString())
        } catch (error: Throwable) {
            throw RemoteProtocolException("sealed frame is not valid session JSON", error)
        }
    }

    fun verificationCode(identityKeyA: ByteArray, identityKeyB: ByteArray): String {
        val ordered = if (compareBytes(identityKeyA, identityKeyB) <= 0) concat(identityKeyA, identityKeyB) else concat(identityKeyB, identityKeyA)
        val digest = hkdf(ordered, ByteArray(0), "$INFO_PREFIX/sas".encodeToByteArray(), 4)
        val value =
            ((digest[0].toLong() and 0xff) shl 24) or
                ((digest[1].toLong() and 0xff) shl 16) or
                ((digest[2].toLong() and 0xff) shl 8) or
                (digest[3].toLong() and 0xff)
        return (value % 1_000_000).toString().padStart(6, '0')
    }

    fun sha256Hex(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.encodeToByteArray()).joinToString("") { byte ->
            (byte.toInt() and 0xff).toString(16).padStart(2, '0')
        }

    fun randomToken(bytes: Int = 32): String = toBase64Url(randomBytes(bytes))

    fun decodePublicKey(value: String, field: String = "public key"): ByteArray {
        val bytes = fromBase64Url(value)
        if (bytes.size != KEY_LENGTH) throw RemoteProtocolException("$field must be 32 bytes")
        return bytes
    }

    fun toBase64Url(bytes: ByteArray): String =
        Base64.toBase64String(bytes).replace('+', '-').replace('/', '_').trimEnd('=')

    fun fromBase64Url(value: String): ByteArray {
        if (value.isEmpty() || !value.matches(Regex("^[A-Za-z0-9_-]+$"))) {
            throw RemoteProtocolException("value is not valid base64url")
        }
        val normalized = value.replace('-', '+').replace('_', '/')
        val padded = normalized + "=".repeat((4 - normalized.length % 4) % 4)
        return try {
            Base64.decode(padded)
        } catch (error: Throwable) {
            throw RemoteProtocolException("value is not valid base64url", error)
        }
    }

    fun bytesEqual(left: ByteArray, right: ByteArray): Boolean {
        if (left.size != right.size) return false
        var diff = 0
        for (index in left.indices) diff = diff or (left[index].toInt() xor right[index].toInt())
        return diff == 0
    }

    internal fun hchacha20(key: ByteArray, nonce: ByteArray): ByteArray {
        require(key.size == KEY_LENGTH && nonce.size == 16)
        val state = IntArray(16)
        state[0] = 0x61707865
        state[1] = 0x3320646e
        state[2] = 0x79622d32
        state[3] = 0x6b206574
        for (index in 0 until 8) state[4 + index] = word(key, index * 4)
        for (index in 0 until 4) state[12 + index] = word(nonce, index * 4)

        fun quarter(a: Int, b: Int, c: Int, d: Int) {
            state[a] += state[b]
            state[d] = (state[d] xor state[a]).rotateLeft(16)
            state[c] += state[d]
            state[b] = (state[b] xor state[c]).rotateLeft(12)
            state[a] += state[b]
            state[d] = (state[d] xor state[a]).rotateLeft(8)
            state[c] += state[d]
            state[b] = (state[b] xor state[c]).rotateLeft(7)
        }
        repeat(10) {
            quarter(0, 4, 8, 12)
            quarter(1, 5, 9, 13)
            quarter(2, 6, 10, 14)
            quarter(3, 7, 11, 15)
            quarter(0, 5, 10, 15)
            quarter(1, 6, 11, 12)
            quarter(2, 7, 8, 13)
            quarter(3, 4, 9, 14)
        }
        val output = ByteArray(32)
        listOf(0, 1, 2, 3, 12, 13, 14, 15).forEachIndexed { index, stateIndex ->
            writeWord(output, index * 4, state[stateIndex])
        }
        return output
    }

    private fun xchacha(
        encrypt: Boolean,
        key: ByteArray,
        nonce: ByteArray,
        input: ByteArray,
        associatedData: String,
    ): ByteArray {
        if (key.size != KEY_LENGTH || nonce.size != NONCE_LENGTH) {
            throw RemoteProtocolException("invalid key or nonce length")
        }
        val subkey = hchacha20(key, nonce.copyOfRange(0, 16))
        val ietfNonce = ByteArray(12).also { nonce.copyOfRange(16, 24).copyInto(it, 4) }
        val cipher = ChaCha20Poly1305()
        cipher.init(encrypt, AEADParameters(KeyParameter(subkey), 128, ietfNonce, associatedData.encodeToByteArray()))
        val output = ByteArray(cipher.getOutputSize(input.size))
        val processed = cipher.processBytes(input, 0, input.size, output, 0)
        val total = processed + cipher.doFinal(output, processed)
        return output.copyOf(total)
    }

    private fun sharedSecret(secretKey: ByteArray, peerPublicKey: ByteArray): ByteArray {
        if (secretKey.size != KEY_LENGTH || peerPublicKey.size != KEY_LENGTH) {
            throw RemoteProtocolException("X25519 keys must be 32 bytes")
        }
        val output = ByteArray(KEY_LENGTH)
        X25519PrivateKeyParameters(secretKey, 0).generateSecret(X25519PublicKeyParameters(peerPublicKey, 0), output, 0)
        return output
    }

    private fun hkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        val generator = HKDFBytesGenerator(SHA256Digest())
        generator.init(HKDFParameters(ikm, salt, info))
        return ByteArray(length).also { generator.generateBytes(it, 0, it.size) }
    }

    private fun concat(vararg parts: ByteArray): ByteArray {
        val output = ByteArray(parts.sumOf(ByteArray::size))
        var offset = 0
        for (part in parts) {
            part.copyInto(output, offset)
            offset += part.size
        }
        return output
    }

    private fun compareBytes(left: ByteArray, right: ByteArray): Int {
        for (index in 0 until minOf(left.size, right.size)) {
            val difference = (left[index].toInt() and 0xff) - (right[index].toInt() and 0xff)
            if (difference != 0) return difference
        }
        return left.size - right.size
    }

    private fun word(bytes: ByteArray, offset: Int): Int =
        (bytes[offset].toInt() and 0xff) or
            ((bytes[offset + 1].toInt() and 0xff) shl 8) or
            ((bytes[offset + 2].toInt() and 0xff) shl 16) or
            ((bytes[offset + 3].toInt() and 0xff) shl 24)

    private fun writeWord(output: ByteArray, offset: Int, value: Int) {
        output[offset] = value.toByte()
        output[offset + 1] = (value ushr 8).toByte()
        output[offset + 2] = (value ushr 16).toByte()
        output[offset + 3] = (value ushr 24).toByte()
    }
}
