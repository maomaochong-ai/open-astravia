package org.vetta.android.domain.remote.connection

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.coroutines.ExperimentalCoroutinesApi
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
import org.vetta.android.domain.remote.protocol.RemoteRequest
import org.vetta.android.domain.remote.protocol.RemoteRequestMethod
import org.vetta.android.domain.remote.protocol.RemoteResponse
import org.vetta.android.domain.remote.protocol.RemoteResume
import org.vetta.android.domain.remote.protocol.RemoteRole

@OptIn(ExperimentalCoroutinesApi::class)
class RemoteConnectionTest {
    @Test
    fun encryptedHandshakeAndRequestResponseBecomeObservable() =
        runTest {
            var now = 100L
            val transport =
                EncryptedDesktopTransport { frame ->
                    if (frame is RemoteRequest) {
                        now = 125L
                        sendSession(RemoteResponse(frame.requestId, success = true, payload = JsonPrimitive("ok")))
                    }
                }
            val connection = connection(transport, backgroundScope, now = { now })

            connection.connect()
            runCurrent()
            assertEquals(RemoteConnectionState.Online, connection.state.value)

            val response = connection.request(RemoteRequestMethod.SessionPrompt, buildJsonObject { put("text", "hello") })

            assertEquals("ok", assertIs<JsonPrimitive>(response).content)
            assertEquals(25L, connection.snapshot().lastRttMs)
            assertEquals(0, connection.snapshot().pendingRequestCount)
            assertTrue(transport.receivedSessions.first() is RemoteResume)
            assertTrue(transport.receivedSessions.any { it is RemoteRequest })
        }

    @Test
    fun eventGapRequestsEncryptedResumeAndDuplicateIsIgnored() =
        runTest {
            val transport = EncryptedDesktopTransport()
            val connection = connection(transport, backgroundScope)
            connection.connect()
            runCurrent()

            transport.sendSession(event(sequence = 1, id = "event-1"))
            runCurrent()
            assertIs<RemoteAck>(transport.receivedSessions.last())

            transport.sendSession(event(sequence = 3, id = "event-3"))
            runCurrent()
            assertEquals(RemoteConnectionState.Recovering, connection.state.value)
            assertEquals(1L, assertIs<RemoteResume>(transport.receivedSessions.last()).lastEventSequence)

            val sentBeforeDuplicate = transport.receivedSessions.size
            transport.sendSession(event(sequence = 1, id = "event-1-copy"))
            runCurrent()
            assertEquals(sentBeforeDuplicate, transport.receivedSessions.size)
            assertEquals(1L, connection.snapshot().lastEventSequence)
        }

    @Test
    fun transportCloseRejectsPendingRequests() =
        runTest {
            val transport = EncryptedDesktopTransport()
            val connection = connection(transport, backgroundScope)
            connection.connect()
            runCurrent()

            var failure: Throwable? = null
            val requestJob =
                launch {
                    failure = runCatching { connection.request(RemoteRequestMethod.DiagnosticsSnapshot) }.exceptionOrNull()
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
    fun encryptedPayloadTextNeverAppearsInMetadataLogs() =
        runTest {
            val logger = RecordingLogger()
            val transport = EncryptedDesktopTransport()
            val connection = connection(transport, backgroundScope, logger)
            connection.connect()
            runCurrent()
            transport.sendSession(
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
        transport: EncryptedDesktopTransport,
        scope: kotlinx.coroutines.CoroutineScope,
        logger: RemoteLogger = NoopRemoteLogger,
        now: () -> Long = { 100L },
    ): RemoteConnection {
        return RemoteConnection(
            transport = transport,
            options =
                RemoteConnectionOptions(
                    role = RemoteRole.Mobile,
                    deviceId = "phone-1",
                    deviceName = "Pixel",
                    capabilities = RemoteCapabilities(chat = true, sessionRead = true),
                    identity = transport.mobileIdentity,
                    expectedPeerIdentityKey = transport.desktopIdentityKey,
                    connectionId = "connection-1",
                    requestTimeoutMs = 1_000,
                ),
            scope = scope,
            logger = logger,
            now = now,
        )
    }

    private fun event(sequence: Long, id: String) =
        RemoteEvent(eventId = id, sequence = sequence, name = RemoteEventName.SessionState)
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
