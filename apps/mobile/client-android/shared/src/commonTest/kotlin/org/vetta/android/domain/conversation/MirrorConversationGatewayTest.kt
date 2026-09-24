package org.vetta.android.domain.conversation

import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.vetta.android.core.model.ChatMessage
import org.vetta.android.core.model.ChatRole
import org.vetta.android.core.model.ChatStreamEvent
import org.vetta.android.data.remote.MemorySessionCache
import org.vetta.android.domain.device.ConnectChannel
import org.vetta.android.domain.device.DeviceStatus
import org.vetta.android.domain.remote.connection.RemoteRequestException
import org.vetta.android.domain.remote.protocol.RemoteErrorCode
import org.vetta.android.domain.remote.protocol.RemoteEventName
import org.vetta.android.domain.remote.protocol.RemoteRequestMethod
import org.vetta.android.domain.work.DesktopMirror
import org.vetta.android.domain.work.FakeDesktop
import org.vetta.android.domain.work.MirrorPlatform
import org.vetta.android.domain.work.eventually
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/** The older desktop chat path, now running over the mirror's single link. */
class MirrorConversationGatewayTest {
    private enum class Script { Answer, Rich, TerminalError, DropOnPrompt }

    private fun TestScope.paired(script: Script): Pair<FakeDesktop, MirrorConversationGateway> {
        val desktop = FakeDesktop(backgroundScope)
        desktop.handler = handler@{ request ->
            when (request.method) {
                RemoteRequestMethod.DiagnosticsSnapshot ->
                    respond(
                        request.requestId,
                        buildJsonObject {
                            put("osLabel", "Windows 11")
                            put("cpu", "Test CPU")
                            put("ram", "16 GB")
                        },
                    )
                RemoteRequestMethod.SessionPrompt -> {
                    val sid = "runtime-session-1"
                    when (script) {
                        Script.DropOnPrompt -> {
                            dropConnections()
                            return@handler
                        }
                        Script.Rich -> {
                            emit(
                                RemoteEventName.SessionTool,
                                buildJsonObject {
                                    put("phase", "started")
                                    put("toolCallId", "call-1")
                                    put("toolName", "read_file")
                                    put("args", "{\"path\":\"README.md\"}")
                                },
                                sid,
                            )
                            emit(
                                RemoteEventName.SessionInput,
                                buildJsonObject {
                                    put("kind", "question")
                                    put("requestId", "req-1")
                                    put("questions", buildJsonArray { add(buildJsonObject { put("question", "继续吗？") }) })
                                },
                                sid,
                            )
                            emit(
                                RemoteEventName.SessionState,
                                buildJsonObject {
                                    put("state", "usage")
                                    put("total", 125)
                                },
                                sid,
                            )
                        }
                        else -> emit(RemoteEventName.SessionMessage, buildJsonObject { put("text", "answer") }, sid)
                    }
                    emit(
                        RemoteEventName.SessionState,
                        buildJsonObject {
                            put("state", if (script == Script.TerminalError) "error" else "completed")
                            if (script == Script.TerminalError) {
                                put("code", "unauthorized")
                                put("message", "Desktop model authentication failed")
                            }
                        },
                        sid,
                    )
                    respond(request.requestId, buildJsonObject { put("sessionId", sid) })
                }
                else -> respond(request.requestId, buildJsonObject {})
            }
        }
        val mirror =
            DesktopMirror(
                MirrorPlatform(
                    settings = MapSettings(),
                    secrets = MapSettings(),
                    cache = MemorySessionCache(),
                    createTransport = desktop.createTransport,
                    deviceName = "Pixel",
                    now = { testScheduler.currentTime },
                ),
                backgroundScope,
            ).also { it.start() }
        return desktop to MirrorConversationGateway(mirror, backgroundScope)
    }

    private suspend fun TestScope.connected(script: Script): Pair<FakeDesktop, MirrorConversationGateway> {
        val (desktop, gateway) = paired(script)
        assertTrue(gateway.connect(desktop.invite(name = "DEV-PC")))
        assertTrue(eventually { gateway.devices.value.singleOrNull()?.status == DeviceStatus.Online })
        return desktop to gateway
    }

    @Test
    fun describesThePairedDesktopAsItsDevice() =
        runTest {
            val (desktop, gateway) = paired(Script.Answer)
            assertTrue(gateway.devices.value.isEmpty(), "nothing is paired yet")
            gateway.connect(desktop.invite(name = "DEV-PC"))
            assertTrue(eventually { gateway.devices.value.singleOrNull()?.cpu == "Test CPU" })
            val device = gateway.devices.value.single()
            assertEquals(desktop.identityKey, device.id)
            assertEquals("DEV-PC", device.name)
            assertEquals("Windows 11", device.osLabel)
            assertEquals(ConnectChannel.Remote, device.channel)
            assertEquals(
                "wss://relay.example/v2/desktop/${FakeDesktop.PAIRING_ID}/viewer#pairing=${FakeDesktop.MOBILE_SECRET}",
                device.viewerUrl,
            )

            gateway.disconnect(device.id)
            assertTrue(eventually { gateway.devices.value.isEmpty() }, "disconnecting forgets the pairing")
        }

    @Test
    fun firstPromptAcceptsOpaqueSessionIdFromDesktopEvent() =
        runTest {
            val (_, gateway) = connected(Script.Answer)
            val events = mutableListOf<ChatStreamEvent>()
            gateway.stream("local-session-1", "desktop-1", null, listOf(ChatMessage(ChatRole.User, "hello"))).collect { events += it }

            assertEquals("answer", (events.first() as ChatStreamEvent.Delta).text)
            assertEquals(ChatStreamEvent.Done, events.last())
            assertEquals("runtime-session-1", gateway.resolvedRemoteSessionId("local-session-1"))
        }

    @Test
    fun streamMapsToolAndUserInputEventsWithoutDroppingTheTurn() =
        runTest {
            val (_, gateway) = connected(Script.Rich)
            val events = mutableListOf<ChatStreamEvent>()
            gateway.stream("local", "desktop-1", null, listOf(ChatMessage(ChatRole.User, "hello"))).collect { events += it }

            assertEquals("read_file", (events[0] as ChatStreamEvent.Tool).toolName)
            assertEquals("req-1", (events[1] as ChatStreamEvent.UserInputRequired).requestId)
            assertEquals(125, (events[2] as ChatStreamEvent.State).usage?.totalTokens)
            assertEquals(ChatStreamEvent.Done, events.last())
        }

    @Test
    fun terminalRemoteErrorKeepsTheDesktopErrorCategory() =
        runTest {
            val (_, gateway) = connected(Script.TerminalError)
            val error =
                assertFailsWith<RemoteRequestException> {
                    gateway.stream("local", "desktop-1", null, listOf(ChatMessage(ChatRole.User, "hello"))).collect { }
                }
            assertEquals(RemoteErrorCode.Unauthorized, error.remoteError.code)
        }

    @Test
    fun aDroppedLinkEndsTheTurnWithAnActionableError() =
        runTest {
            val (_, gateway) = connected(Script.DropOnPrompt)
            val error =
                assertFailsWith<RemoteRequestException> {
                    gateway.stream("local", "desktop-1", null, listOf(ChatMessage(ChatRole.User, "hello"))).collect { }
                }
            assertEquals(RemoteErrorCode.TransportClosed, error.remoteError.code)
        }
}
