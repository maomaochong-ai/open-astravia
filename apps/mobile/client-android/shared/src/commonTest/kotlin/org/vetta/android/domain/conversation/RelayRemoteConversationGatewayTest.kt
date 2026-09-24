package org.vetta.android.domain.conversation

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.buildJsonArray
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
import kotlin.test.assertFailsWith

@OptIn(ExperimentalCoroutinesApi::class)
class RelayRemoteConversationGatewayTest {
    @Test
    fun firstPromptAcceptsOpaqueSessionIdFromDesktopEvent() =
        runTest {
            val transport = FakeGatewayTransport()
            val gateway =
                RelayRemoteConversationGateway(
                    scope = backgroundScope,
                    transportFactory = { _, _ -> transport },
                    now = { 1_000L },
                )
            gateway.connect(transport.target)

            val device = gateway.devices.value.single()
            assertEquals("Windows 11", device.osLabel)
            assertEquals("Test CPU", device.cpu)
            assertEquals("16 GB", device.ram)
            assertEquals(0, device.latencyMs)
            assertEquals(0L, device.connectedDurationMs)

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

    @Test
    fun streamMapsToolAndUserInputEventsWithoutDroppingTheTurn() =
        runTest {
            val transport = FakeGatewayTransport(richEvents = true)
            val gateway = RelayRemoteConversationGateway(scope = backgroundScope, transportFactory = { _, _ -> transport }, now = { 1_000L })
            gateway.connect(transport.target)
            val events = mutableListOf<ChatStreamEvent>()
            gateway.stream("local", "desktop-1", null, listOf(ChatMessage(ChatRole.User, "hello"))).collect { events += it }
            assertEquals(
                ChatStreamEvent.Tool(
                    "started",
                    "call-1",
                    "read_file",
                    "{\"path\":\"README.md\"}",
                    null,
                    "{\"path\":\"README.md\"}",
                    null,
                ),
                events[0],
            )
            assertEquals(
                ChatStreamEvent.Tool(
                    phase = "phase",
                    toolCallId = "call-1",
                    toolName = "read_file",
                    phaseLabel = "读取文件内容",
                ),
                events[1],
            )
            assertEquals("req-1", (events[2] as ChatStreamEvent.UserInputRequired).requestId)
            assertEquals(125, (events[3] as ChatStreamEvent.State).usage?.totalTokens)
            assertEquals(ChatStreamEvent.Done, events.last())
        }

    @Test
    fun terminalRemoteErrorKeepsTheDesktopErrorCategory() =
        runTest {
            val transport = FakeGatewayTransport(terminalErrorCode = "unauthorized")
            val gateway = RelayRemoteConversationGateway(scope = backgroundScope, transportFactory = { _, _ -> transport }, now = { 1_000L })
            gateway.connect(transport.target)
            val error = assertFailsWith<org.vetta.android.domain.remote.connection.RemoteRequestException> {
                gateway.stream("local", "desktop-1", null, listOf(ChatMessage(ChatRole.User, "hello"))).collect { }
            }
            assertEquals(org.vetta.android.domain.remote.protocol.RemoteErrorCode.Unauthorized, error.remoteError.code)
        }

    @Test
    fun transportRecoveryEndsTheTurnWithAnActionableError() =
        runTest {
            val transport = FakeGatewayTransport(disconnectOnPrompt = true)
            val gateway = RelayRemoteConversationGateway(scope = backgroundScope, transportFactory = { _, _ -> transport }, now = { 1_000L })
            gateway.connect(transport.target)

            val error = assertFailsWith<org.vetta.android.domain.remote.connection.RemoteRequestException> {
                gateway.stream("local", "desktop-1", null, listOf(ChatMessage(ChatRole.User, "hello"))).collect { }
            }

            assertEquals(org.vetta.android.domain.remote.protocol.RemoteErrorCode.TransportClosed, error.remoteError.code)
        }

    @Test
    fun relayReconnectsWhenDesktopReplacesTheInitialControlSocket() =
        runTest {
            val initial = FakeGatewayTransport()
            val replacements = mutableListOf<FakeGatewayTransport>()
            var first = true
            val gateway =
                RelayRemoteConversationGateway(
                    scope = backgroundScope,
                    transportFactory = { _, _ ->
                        if (first) {
                            first = false
                            initial
                        } else {
                            FakeGatewayTransport().also { replacements += it }
                        }
                    },
                    now = { 1_000L },
                )

            gateway.connect(initial.target)
            initial.disconnect()
            runCurrent()
            advanceTimeBy(250)
            runCurrent()

            assertEquals(1, replacements.size)
            assertEquals(org.vetta.android.domain.device.DeviceStatus.Online, gateway.devices.value.single().status)
        }
}

private class FakeGatewayTransport(
    private val richEvents: Boolean = false,
    private val terminalErrorCode: String? = null,
    private val disconnectOnPrompt: Boolean = false,
) : RemoteTransport {
    private val delegate =
        org.vetta.android.domain.remote.connection.EncryptedDesktopTransport { frame ->
            if (frame is RemoteRequest) {
                if (frame.method == org.vetta.android.domain.remote.protocol.RemoteRequestMethod.DiagnosticsSnapshot) {
                    sendSession(
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
                    return@EncryptedDesktopTransport
                }
                if (disconnectOnPrompt) {
                    disconnect()
                    return@EncryptedDesktopTransport
                }
                if (richEvents) {
                    sendSession(RemoteEvent("tool-1", 1, RemoteEventName.SessionTool, "runtime-session-1", buildJsonObject {
                        put("phase", "started")
                        put("toolCallId", "call-1")
                        put("toolName", "read_file")
                        put("args", "{\"path\":\"README.md\"}")
                    }))
                    sendSession(RemoteEvent("phase-1", 2, RemoteEventName.SessionTool, "runtime-session-1", buildJsonObject {
                        put("phase", "phase")
                        put("toolCallId", "call-1")
                        put("toolName", "read_file")
                        put("label", "读取文件内容")
                    }))
                    sendSession(RemoteEvent("input-1", 3, RemoteEventName.SessionInput, "runtime-session-1", buildJsonObject {
                        put("kind", "question")
                        put("requestId", "req-1")
                        put("questions", buildJsonArray { add(buildJsonObject { put("question", "继续吗？"); put("header", "确认"); put("options", buildJsonArray { add(buildJsonObject { put("label", "继续") }) }) }) })
                    }))
                    sendSession(RemoteEvent("usage-1", 4, RemoteEventName.SessionState, "runtime-session-1", buildJsonObject {
                        put("state", "usage")
                        put("input", 100)
                        put("output", 25)
                        put("total", 125)
                        put("contextPercent", 12)
                    }))
                } else {
                    sendSession(RemoteEvent("event-1", 1, RemoteEventName.SessionMessage, "runtime-session-1", buildJsonObject { put("text", "answer") }))
                }
                sendSession(RemoteEvent("state-1", if (richEvents) 5 else 2, RemoteEventName.SessionState, "runtime-session-1", buildJsonObject {
                    put("state", if (terminalErrorCode == null) "completed" else "error")
                    terminalErrorCode?.let { put("code", it) }
                    terminalErrorCode?.let { put("message", "Desktop model authentication failed") }
                }))
                sendSession(
                    RemoteResponse(
                        requestId = frame.requestId,
                        success = true,
                        payload = buildJsonObject {
                            put("sessionId", "runtime-session-1")
                        },
                    ),
                )
            }
        }

    val target: String get() = delegate.target
    override val incoming = delegate.incoming
    override suspend fun connect() = delegate.connect()
    override suspend fun send(frame: RemoteFrame) = delegate.send(frame)
    override suspend fun close() = delegate.close()

    fun disconnect() = delegate.disconnect()
}
