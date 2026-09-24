package org.vetta.android.domain.remote.protocol

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

class RemoteProtocolException(message: String, cause: Throwable? = null) :
    IllegalArgumentException(message, cause)

object RemoteProtocol {
    private val json =
        Json {
            classDiscriminator = "type"
            ignoreUnknownKeys = true
            explicitNulls = false
            encodeDefaults = true
        }

    fun encode(frame: RemoteFrame): String {
        validate(frame)
        return json.encodeToString(RemoteFrame.serializer(), frame)
    }

    fun decode(value: String): RemoteFrame {
        val frame =
            try {
                json.decodeFromString(RemoteFrame.serializer(), value)
            } catch (error: SerializationException) {
                throw RemoteProtocolException("Remote frame is not valid protocol JSON", error)
            }
        validate(frame)
        return frame
    }

    fun encodeSession(frame: RemoteSessionFrame): String = encode(frame)

    fun decodeSession(value: String): RemoteSessionFrame {
        val frame = decode(value)
        return frame as? RemoteSessionFrame
            ?: throw RemoteProtocolException("Encrypted payload must contain a session frame")
    }

    fun validate(frame: RemoteFrame) {
        when (frame) {
            is RemoteHello -> {
                requireVersion(frame.protocolVersion)
                requireText(frame.deviceId, "deviceId")
                requireText(frame.deviceName, "deviceName")
                requireText(frame.connectionId, "connectionId")
                requirePublicKey(frame.identityKey, "identityKey")
                requirePublicKey(frame.ephemeralKey, "ephemeralKey")
            }
            is RemoteHelloAck -> {
                requireVersion(frame.protocolVersion)
                requireText(frame.connectionId, "connectionId")
                requireText(frame.peerDeviceId, "peerDeviceId")
                requirePublicKey(frame.peerIdentityKey, "peerIdentityKey")
                requirePublicKey(frame.peerEphemeralKey, "peerEphemeralKey")
            }
            is RemotePairingPending -> {
                requireText(frame.connectionId, "connectionId")
                requireText(frame.peerDeviceId, "peerDeviceId")
                requirePublicKey(frame.peerIdentityKey, "peerIdentityKey")
            }
            is RemotePeerStatus -> Unit
            is RemoteSealed -> {
                if (runCatching { RemoteCrypto.fromBase64Url(frame.nonce) }.getOrNull()?.size != 24) {
                    throw RemoteProtocolException("sealed nonce must be 24 bytes")
                }
                if (frame.ciphertext.isEmpty() || !frame.ciphertext.matches(BASE64_URL_PATTERN)) {
                    throw RemoteProtocolException("sealed ciphertext must be base64url")
                }
            }
            is RemoteRequest -> {
                requireText(frame.requestId, "requestId")
                frame.sessionId?.let { requireText(it, "sessionId") }
            }
            is RemoteResponse -> {
                requireText(frame.requestId, "requestId")
                if (frame.success && frame.error != null) {
                    throw RemoteProtocolException("Successful response must not include error")
                }
                if (!frame.success && frame.error == null) {
                    throw RemoteProtocolException("Failed response must include error")
                }
                frame.error?.let { requireText(it.message, "error.message") }
            }
            is RemoteEvent -> {
                requireText(frame.eventId, "eventId")
                requirePositive(frame.sequence, "sequence")
                frame.sessionId?.let { requireText(it, "sessionId") }
            }
            is RemoteAck -> requirePositive(frame.sequence, "sequence")
            is RemoteResume -> {
                if (frame.lastEventSequence < 0) {
                    throw RemoteProtocolException("lastEventSequence must be non-negative")
                }
            }
        }
    }

    private fun requireVersion(version: Int) {
        if (version != REMOTE_PROTOCOL_VERSION) {
            throw RemoteProtocolException("Unsupported remote protocol version: $version")
        }
    }

    private fun requireText(value: String, field: String) {
        if (value.isEmpty() || value.length > 512) {
            throw RemoteProtocolException("$field must be a non-empty string")
        }
    }

    private fun requirePositive(value: Long, field: String) {
        if (value < 1) throw RemoteProtocolException("$field must be positive")
    }

    private fun requirePublicKey(value: String, field: String) {
        runCatching { RemoteCrypto.decodePublicKey(value, field) }.getOrElse { error ->
            throw RemoteProtocolException(error.message ?: "$field must be 32 bytes", error)
        }
    }

    private val BASE64_URL_PATTERN = Regex("^[A-Za-z0-9_-]+$")
}
