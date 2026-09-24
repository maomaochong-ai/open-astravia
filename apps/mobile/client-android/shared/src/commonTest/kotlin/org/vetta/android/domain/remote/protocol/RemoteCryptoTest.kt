package org.vetta.android.domain.remote.protocol

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class RemoteCryptoTest {
    @Test
    fun matchesDesktopPublicKeysAndDirectionalSessionKeys() {
        val mobile = pair(MOBILE_IDENTITY_SECRET)
        val mobileEphemeral = pair(MOBILE_EPHEMERAL_SECRET)
        val desktop = pair(DESKTOP_IDENTITY_SECRET)
        val desktopEphemeral = pair(DESKTOP_EPHEMERAL_SECRET)

        assertEquals(MOBILE_IDENTITY_PUBLIC, RemoteCrypto.toBase64Url(mobile.publicKey))
        assertEquals(DESKTOP_IDENTITY_PUBLIC, RemoteCrypto.toBase64Url(desktop.publicKey))

        val mobileKeys =
            RemoteCrypto.deriveSessionKeys(
                RemoteRole.Mobile,
                mobile,
                mobileEphemeral,
                desktop.publicKey,
                desktopEphemeral.publicKey,
            )
        val desktopKeys =
            RemoteCrypto.deriveSessionKeys(
                RemoteRole.Desktop,
                desktop,
                desktopEphemeral,
                mobile.publicKey,
                mobileEphemeral.publicKey,
            )

        assertEquals(MOBILE_SEND, RemoteCrypto.toBase64Url(mobileKeys.sendKey))
        assertEquals(MOBILE_RECEIVE, RemoteCrypto.toBase64Url(mobileKeys.receiveKey))
        assertContentEquals(mobileKeys.sendKey, desktopKeys.receiveKey)
        assertContentEquals(mobileKeys.receiveKey, desktopKeys.sendKey)
    }

    @Test
    fun opensDesktopCiphertextAndRejectsTampering() {
        val key = RemoteCrypto.fromBase64Url(MOBILE_RECEIVE)
        val sealed = RemoteSealed(SEALED_NONCE, SEALED_CIPHERTEXT)
        val frame = assertIs<RemoteEvent>(RemoteCrypto.openFrame(key, sealed))

        assertEquals(1, frame.sequence)
        assertEquals(RemoteEventName.SessionMessage, frame.name)
        assertEquals("你好 world", frame.payload?.jsonObject?.get("text")?.jsonPrimitive?.content)
        assertFailsWith<RemoteProtocolException> {
            RemoteCrypto.openFrame(key, sealed.copy(ciphertext = SEALED_CIPHERTEXT.replaceRange(10, 11, "A")))
        }
        assertFailsWith<RemoteProtocolException> { RemoteCrypto.openFrame(key, sealed, "other") }
    }

    @Test
    fun matchesVerificationCodeHashAndHchachaVector() {
        val mobile = RemoteCrypto.fromBase64Url(MOBILE_IDENTITY_PUBLIC)
        val desktop = RemoteCrypto.fromBase64Url(DESKTOP_IDENTITY_PUBLIC)
        assertEquals("362234", RemoteCrypto.verificationCode(mobile, desktop))
        assertEquals("362234", RemoteCrypto.verificationCode(desktop, mobile))
        assertEquals(
            "7609e696580e3b7b6bc52c2c60df9e03f2419358ddf17e60e1013177129b6620",
            RemoteCrypto.sha256Hex("secret-1234567890abcdef"),
        )
        val nonce = byteArrayOf(0, 0, 0, 9, 0, 0, 0, 0x4a, 0, 0, 0, 0, 0x31, 0x41, 0x59, 0x27)
        assertEquals(
            "82413b4227b27bfed30e42508a877d73a0f9e4d58a74a853c12ec41326d3ecdc",
            RemoteCrypto.hchacha20(ByteArray(32) { it.toByte() }, nonce).toHex(),
        )
    }

    private fun pair(secret: String): RemoteIdentityKeyPair =
        RemoteCrypto.identityKeyPairFromSecret(RemoteCrypto.fromBase64Url(secret))

    private fun ByteArray.toHex(): String = joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }

    private companion object {
        const val MOBILE_IDENTITY_SECRET = "HyYtNDtCSVBXXmVsc3qBiI-WnaSrsrnAx87V3OPq8fg"
        const val MOBILE_IDENTITY_PUBLIC = "5XxpXrLGE8G-VOthU0PoK2qVT4hAmqOtH6c50AQfGiY"
        const val MOBILE_EPHEMERAL_SECRET = "PkVMU1phaG92fYSLkpmgp661vMPK0djf5u30-wIJEBc"
        const val DESKTOP_IDENTITY_SECRET = "XWRrcnmAh46VnKOqsbi_xs3U2-Lp8Pf-BQwTGiEoLzY"
        const val DESKTOP_IDENTITY_PUBLIC = "V-U_7B2yLhcIrcj6dteUYQTZpeC-YvqqG-h-d--vWyI"
        const val DESKTOP_EPHEMERAL_SECRET = "fIOKkZifpq20u8LJ0Nfe5ezz-gEIDxYdJCsyOUBHTlU"
        const val MOBILE_SEND = "FlqK4Ma7JMspbHxbahkRqv1gaHD6ht4cHEk46qjdI4w"
        const val MOBILE_RECEIVE = "ZVa6cVHRj3-7Nrhc7_sxUHnW6LYxx7JzejWaT_P4tFY"
        const val SEALED_NONCE = "ZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp7"
        const val SEALED_CIPHERTEXT =
            "OLWYn41kNHag8Ra9OiXptS39Y94ycZZ-lePe669kR4P6qgYv0lvvcEuI-FeV257_R2i-0ZXj2vISjJzRKjgnZcxw3IQxTL4Y-nFAlC1QamGizQoxS1aKqpd2DTYk_ZoTZK8RU8XdhpT8FJ8YTWifWDbPi1ka9VKcMtVqaHHqE2cycgWsiOHl0lmC4xkx3gIHZhH6GAroYcdWJNQg9kvhwyoS"
    }
}
