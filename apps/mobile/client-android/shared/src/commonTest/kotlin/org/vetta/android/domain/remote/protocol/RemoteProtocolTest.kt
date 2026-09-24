package org.vetta.android.domain.remote.protocol

import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs

class RemoteProtocolTest {
    @Test
    fun helloRoundTripsWithTypeDiscriminator() {
        val hello =
            RemoteHello(
                role = RemoteRole.Mobile,
                deviceId = "phone-1",
                deviceName = "Pixel",
                capabilities = RemoteCapabilities(chat = true, sessionRead = true),
                connectionId = "connection-1",
                identityKey = KEY,
                ephemeralKey = KEY,
            )

        val encoded = RemoteProtocol.encode(hello)
        val decoded = RemoteProtocol.decode(encoded)

        assertEquals(hello, assertIs<RemoteHello>(decoded))
        assertEquals(true, encoded.contains("\"type\":\"hello\""))
        assertEquals(true, encoded.contains("\"protocolVersion\":2"))
    }

    @Test
    fun typescriptCompatibleRequestDecodes() {
        val frame =
            RemoteProtocol.decode(
                """{"type":"request","requestId":"req-1","method":"session.prompt","sessionId":"s-1","payload":{"text":"hello"}}""",
            )

        val request = assertIs<RemoteRequest>(frame)
        assertEquals(RemoteRequestMethod.SessionPrompt, request.method)
        assertEquals("hello", request.payload?.jsonObject?.get("text")?.jsonPrimitive?.content)
    }

    @Test
    fun invalidResponseAndSequenceAreRejected() {
        assertFailsWith<RemoteProtocolException> {
            RemoteProtocol.decode(
                """{"type":"response","requestId":"req-1","success":false}""",
            )
        }
        assertFailsWith<RemoteProtocolException> {
            RemoteProtocol.decode(
                """{"type":"event","eventId":"event-1","sequence":0,"name":"session.message"}""",
            )
        }
    }

    @Test
    fun rejectsV1AndHandshakeFramesInsideEncryption() {
        assertFailsWith<RemoteProtocolException> {
            RemoteProtocol.decode(
                """{"type":"hello","protocolVersion":1,"role":"mobile","deviceId":"p","deviceName":"Pixel","capabilities":{"chat":true,"sessionRead":true},"connectionId":"c","identityKey":"$KEY","ephemeralKey":"$KEY"}""",
            )
        }
        assertFailsWith<RemoteProtocolException> {
            RemoteProtocol.decodeSession(RemoteProtocol.encode(RemotePeerStatus(true)))
        }
    }

    private companion object {
        const val KEY = "5XxpXrLGE8G-VOthU0PoK2qVT4hAmqOtH6c50AQfGiY"
    }
}
