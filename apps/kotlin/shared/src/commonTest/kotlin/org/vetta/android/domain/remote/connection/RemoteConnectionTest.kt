package org.vetta.android.domain.remote.connection

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.vetta.android.domain.remote.protocol.RemoteAck
import org.vetta.android.domain.remote.protocol.RemoteCapabilities
import org.vetta.android.domain.remote.protocol.RemoteEvent
import org.vetta.android.domain.remote.protocol.RemoteEventName
import org.vetta.android.domain.remote.protocol.RemoteFrame
import org.vetta.android.domain.remote.protocol.RemoteHello
import org.vetta.android.domain.remote.protocol.RemoteHelloAck
import org.vetta.android.domain.remote.protocol.RemoteRequest
import org.vetta.android.domain.remote.protocol.RemoteRequestMethod
import org.vetta.android.domain.remote.protocol.RemoteResponse
import org.vetta.android.domain.remote.protocol.RemoteResume
import org.vetta.android.domain.remote.protocol.RemoteRole
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class RemoteConnectionTest {
    @Test
    fun handshakeAndRequestResponseBecomeObservable() =
        runTest {
            val transport = FakeRemoteTransport()
            var now = 100L
            val connection = connection(transport = transport, now = { now }, scope = backgroundScope)

            connection.connect()
            runCurrent()
            assertIs<RemoteHello>(transport.sent.single())
            transport.receive(RemoteHelloAck(connectionId = "connection-1", peerDeviceId = "desktop-1"))
            runCurrent()
            assertEquals(RemoteConnectionState.Online, connection.state.value)

            var response: JsonPrimitive? = null
            val requestJob =
                launch {
                    response =
                        connection.request(
                            RemoteRequestMethod.SessionPrompt,
                            buildJsonObject { put("text", "hello") },
                            "session-1",
                        ) as JsonPrimitive
                }
            runCurrent()
            val request = assertIs<RemoteRequest>(transport.sent.last())
            now = 125L
            transport.receive(
                RemoteResponse(
                    requestId = request.requestId,
                    success = true,
                    payload = JsonPrimitive("ok"),
                ),
            )
            requestJob.join()

            assertEquals("ok", response?.content)
            assertEquals(25L, connection.snapshot().lastRttMs)
            assertEquals(0, connection.snapshot().pendingRequestCount)
        }

    @Test
    fun eventGapRequestsResumeAndDuplicateIsIgnored() =
        runTest {
            val transport = FakeRemoteTransport()
            val connection = connection(transport = transport, scope = backgroundScope)
            connection.connect()
            runCurrent()
            transport.receive(RemoteHelloAck(connectionId = "connection-1", peerDeviceId = "desktop-1"))
            transport.receive(event(sequence = 1, id = "event-1"))
            runCurrent()
            assertIs<RemoteAck>(transport.sent.last())

            transport.receive(event(sequence = 3, id = "event-3"))
            runCurrent()
            assertEquals(RemoteConnectionState.Recovering, connection.state.value)
            assertEquals(1L, assertIs<RemoteResume>(transport.sent.last()).lastEventSequence)

            val sentBeforeDuplicate = transport.sent.size
            transport.receive(event(sequence = 1, id = "event-1-copy"))
            runCurrent()
            assertEquals(sentBeforeDuplicate, transport.sent.size)
            assertEquals(1L, connection.snapshot().lastEventSequence)
        }

    @Test
    fun transportCloseRejectsPendingRequests() =
        runTest {
            val transport = FakeRemoteTransport()
            val connection = connection(transport = transport, scope = backgroundScope)
            connection.connect()
            runCurrent()
            transport.receive(RemoteHelloAck(connectionId = "connection-1", peerDeviceId = "desktop-1"))
            runCurrent()

            var failure: Throwable? = null
            val requestJob =
                launch {
                    failure =
                        runCatching {
                            connection.request(RemoteRequestMethod.DiagnosticsSnapshot)
                        }.exceptionOrNull()
                }
            runCurrent()
            transport.disconnect()
            advanceUntilIdle()
            requestJob.join()

            assertIs<RemoteRequestException>(failure)
            assertEquals(RemoteConnectionState.Reconnecting, connection.state.value)
            assertEquals(0, connection.snapshot().pendingRequestCount)
        }

    @Test
    fun metadataLogsNeverContainPayloadText() =
        runTest {
            val logger = RecordingLogger()
            val transport = FakeRemoteTransport()
            val connection = connection(transport, backgroundScope, logger = logger)
            connection.connect()
            runCurrent()
            transport.receive(RemoteHelloAck(connectionId = "connection-1", peerDeviceId = "desktop-1"))
            transport.receive(
                RemoteEvent(
                    eventId = "event-1",
                    sequence = 1,
                    name = RemoteEventName.SessionMessage,
                    payload = buildJsonObject { put("text", "PRIVATE-CONTENT") },
                ),
            )
            runCurrent()

            assertTrue(logger.entries.none { it.contains("PRIVATE-CONTENT") })
        }

    private fun connection(
        transport: FakeRemoteTransport,
        scope: kotlinx.coroutines.CoroutineScope,
        logger: RemoteLogger = NoopRemoteLogger,
        now: () -> Long = { 100L },
    ) =
        RemoteConnection(
            transport = transport,
            options =
                RemoteConnectionOptions(
                    role = RemoteRole.Mobile,
                    deviceId = "phone-1",
                    deviceName = "Pixel",
                    capabilities = RemoteCapabilities(chat = true, sessionRead = true),
                    connectionId = "connection-1",
                    requestTimeoutMs = 1_000,
                ),
            scope = scope,
            logger = logger,
            now = now,
        )

    private fun event(sequence: Long, id: String) =
        RemoteEvent(
            eventId = id,
            sequence = sequence,
            name = RemoteEventName.SessionState,
        )
}

private class FakeRemoteTransport : RemoteTransport {
    private val channel = Channel<RemoteFrame>(Channel.UNLIMITED)
    override val incoming: Flow<RemoteFrame> = channel.receiveAsFlow()
    val sent = mutableListOf<RemoteFrame>()

    override suspend fun connect() = Unit

    override suspend fun send(frame: RemoteFrame) {
        sent += frame
    }

    override suspend fun close() {
        channel.close()
    }

    suspend fun receive(frame: RemoteFrame) {
        channel.send(frame)
    }

    fun disconnect() {
        channel.close()
    }
}

private class RecordingLogger : RemoteLogger {
    val entries = mutableListOf<String>()

    override fun debug(message: String, fields: Map<String, Any?>) {
        entries += "$message $fields"
    }

    override fun info(message: String, fields: Map<String, Any?>) {
        entries += "$message $fields"
    }

    override fun warn(message: String, fields: Map<String, Any?>) {
        entries += "$message $fields"
    }
}
