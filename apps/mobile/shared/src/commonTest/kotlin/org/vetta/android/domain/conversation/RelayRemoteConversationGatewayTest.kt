package org.vetta.android.domain.conversation

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.vetta.android.core.model.ChatMessage
import org.vetta.android.core.model.ChatRole
import org.vetta.android.core.model.ChatStreamEvent
import org.vetta.android.domain.remote.connection.RemoteTransport
import org.vetta.android.domain.remote.protocol.RemoteEvent
import org.vetta.android.domain.remote.protocol.RemoteEventName
import org.vetta.android.domain.remote.protocol.RemoteFrame
import org.vetta.android.domain.remote.protocol.RemoteHelloAck
import org.vetta.android.domain.remote.protocol.RemoteRequest
import org.vetta.android.domain.remote.protocol.RemoteResponse
import kotlin.test.Test
import kotlin.test.assertEquals

@OptIn(ExperimentalCoroutinesApi::class)
class RelayRemoteConversationGatewayTest {
    @Test
    fun firstPromptAcceptsOpaqueSessionIdFromDesktopEvent() =
        runTest {
            val transport = FakeGatewayTransport()
            val gateway =
                RelayRemoteConversationGateway(
                    scope = backgroundScope,
                    transportFactory = { transport },
                    now = { 1_000L },
                )
            gateway.connect("fake-relay")

            val device = gateway.devices.value.single()
            assertEquals("Windows 11", device.osLabel)
            assertEquals("Test CPU", device.cpu)
            assertEquals("16 GB", device.ram)
            assertEquals(0, device.latencyMs)
            assertEquals("1秒", device.connectedDuration)

            val events = mutableListOf<ChatStreamEvent>()
            gateway
                .stream(
                    localSessionId = "local-session-1",
                    deviceId = "desktop-1",
                    remoteSessionId = null,
                    messages = listOf(ChatMessage(ChatRole.User, "hello")),
                ).collect { events += it }

            assertEquals("answer", (events.first() as ChatStreamEvent.Delta).text)
            assertEquals(ChatStreamEvent.Done, events.last())
            assertEquals("runtime-session-1", gateway.resolvedRemoteSessionId("local-session-1"))
        }
}

private class FakeGatewayTransport : RemoteTransport {
    private val channel = Channel<RemoteFrame>(Channel.UNLIMITED)
    override val incoming: Flow<RemoteFrame> = channel.receiveAsFlow()

    override suspend fun connect() = Unit

    override suspend fun send(frame: RemoteFrame) {
        when (frame) {
            is org.vetta.android.domain.remote.protocol.RemoteHello ->
                channel.send(RemoteHelloAck(connectionId = frame.connectionId, peerDeviceId = "desktop-1"))
            is RemoteRequest -> {
                if (frame.method == org.vetta.android.domain.remote.protocol.RemoteRequestMethod.DiagnosticsSnapshot) {
                    channel.send(
                        RemoteResponse(
                            requestId = frame.requestId,
                            success = true,
                            payload = buildJsonObject {
                                put("osLabel", "Windows 11")
                                put("cpu", "Test CPU")
                                put("ram", "16 GB")
                            },
                        ),
                    )
                    return
                }
                channel.send(
                    RemoteEvent(
                        eventId = "event-1",
                        sequence = 1,
                        name = RemoteEventName.SessionMessage,
                        sessionId = "runtime-session-1",
                        payload = buildJsonObject { put("text", "answer") },
                    ),
                )
                channel.send(
                    RemoteResponse(
                        requestId = frame.requestId,
                        success = true,
                        payload = buildJsonObject {
                            put("sessionId", "runtime-session-1")
                        },
                    ),
                )
            }
            else -> Unit
        }
    }

    override suspend fun close() {
        channel.close()
    }
}
