package org.vetta.android.domain.remote.connection

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonElement
import org.vetta.android.domain.remote.protocol.REMOTE_PROTOCOL_VERSION
import org.vetta.android.domain.remote.protocol.RemoteAck
import org.vetta.android.domain.remote.protocol.RemoteCapabilities
import org.vetta.android.domain.remote.protocol.RemoteCrypto
import org.vetta.android.domain.remote.protocol.RemoteError
import org.vetta.android.domain.remote.protocol.RemoteErrorCode
import org.vetta.android.domain.remote.protocol.RemoteEvent
import org.vetta.android.domain.remote.protocol.RemoteEventName
import org.vetta.android.domain.remote.protocol.RemoteFrame
import org.vetta.android.domain.remote.protocol.RemoteHello
import org.vetta.android.domain.remote.protocol.RemoteHelloAck
import org.vetta.android.domain.remote.protocol.RemoteIdentityKeyPair
import org.vetta.android.domain.remote.protocol.RemotePairingPending
import org.vetta.android.domain.remote.protocol.RemotePeerStatus
import org.vetta.android.domain.remote.protocol.RemoteRequest
import org.vetta.android.domain.remote.protocol.RemoteRequestMethod
import org.vetta.android.domain.remote.protocol.RemoteResponse
import org.vetta.android.domain.remote.protocol.RemoteResume
import org.vetta.android.domain.remote.protocol.RemoteRole
import org.vetta.android.domain.remote.protocol.RemoteSealed
import org.vetta.android.domain.remote.protocol.RemoteSessionFrame
import org.vetta.android.domain.remote.protocol.RemoteSessionKeys

enum class RemoteConnectionState {
    Idle,
    Connecting,
    PendingApproval,
    Online,
    Recovering,
    Reconnecting,
    Closed,
    Failed,
}

sealed interface RemoteConnectionEvent {
    data class RequestReceived(val request: RemoteRequest) : RemoteConnectionEvent

    data class EventReceived(val event: RemoteEvent) : RemoteConnectionEvent

    data class PeerStatusChanged(val online: Boolean) : RemoteConnectionEvent

    data class ErrorReceived(val error: RemoteError) : RemoteConnectionEvent
}

data class RemoteConnectionSnapshot(
    val state: RemoteConnectionState,
    val deviceId: String,
    val connectionId: String,
    val peerDeviceId: String?,
    val peerIdentityKey: String?,
    val lastEventSequence: Long,
    val lastAckSequence: Long,
    val pendingRequestCount: Int,
    val reconnectCount: Int,
    val lastRttMs: Long?,
    val lastErrorCode: RemoteErrorCode?,
)

data class RemoteConnectionOptions(
    val role: RemoteRole,
    val deviceId: String,
    val deviceName: String,
    val capabilities: RemoteCapabilities,
    val identity: RemoteIdentityKeyPair,
    /**
     * The desktop's pinned identity key. Null only for a manual pairing, where the
     * key is learnt from the desktop and the person compares the verification code.
     */
    val expectedPeerIdentityKey: ByteArray?,
    val connectionId: String,
    val requestTimeoutMs: Long = 30_000,
    /** The last event this phone saw from the desktop; the handshake resumes after it. */
    val resumeFrom: Long = 0,
    val randomBytes: (Int) -> ByteArray = RemoteCrypto::randomBytes,
)

class RemoteRequestException(val remoteError: RemoteError) : IllegalStateException(remoteError.message)

class RemoteConnection(
    private val transport: RemoteTransport,
    private val options: RemoteConnectionOptions,
    private val scope: CoroutineScope,
    private val logger: RemoteLogger = NoopRemoteLogger,
    private val now: () -> Long,
) {
    private data class PendingRequest(
        val startedAt: Long,
        val result: CompletableDeferred<JsonElement?>,
    )

    private val mutex = Mutex()
    private val pending = mutableMapOf<String, PendingRequest>()
    private val _state = MutableStateFlow(RemoteConnectionState.Idle)
    private val _events = MutableSharedFlow<RemoteConnectionEvent>(extraBufferCapacity = 32)
    private val earlySealed = mutableListOf<RemoteSealed>()
    private var incomingJob: Job? = null
    private var requestCounter = 0L
    private var ephemeral: RemoteIdentityKeyPair? = null
    private var keys: RemoteSessionKeys? = null
    private var peerDeviceId: String? = null
    private var peerIdentityKey: ByteArray? = null
    private var lastEventSequence = options.resumeFrom
    private var lastAckSequence = 0L
    private var reconnectCount = 0
    private var lastRttMs: Long? = null
    private var lastErrorCode: RemoteErrorCode? = null

    val state: StateFlow<RemoteConnectionState> = _state.asStateFlow()
    val events: SharedFlow<RemoteConnectionEvent> = _events.asSharedFlow()

    suspend fun connect() {
        if (_state.value == RemoteConnectionState.Online || _state.value == RemoteConnectionState.Connecting) return
        _state.value = if (_state.value == RemoteConnectionState.Idle) RemoteConnectionState.Connecting else RemoteConnectionState.Reconnecting
        ephemeral = RemoteCrypto.generateIdentityKeyPair(options.randomBytes)
        keys = null
        earlySealed.clear()
        try {
            incomingJob?.cancelAndJoin()
            incomingJob =
                scope.launch {
                    try {
                        transport.incoming.collect(::handleFrame)
                        handleTransportClosed("incoming stream completed")
                    } catch (error: Throwable) {
                        handleTransportClosed(error.message)
                    }
                }
            transport.connect()
            val currentEphemeral = requireNotNull(ephemeral)
            transport.send(
                RemoteHello(
                    protocolVersion = REMOTE_PROTOCOL_VERSION,
                    role = options.role,
                    deviceId = options.deviceId,
                    deviceName = options.deviceName,
                    capabilities = options.capabilities,
                    connectionId = options.connectionId,
                    identityKey = RemoteCrypto.toBase64Url(options.identity.publicKey),
                    ephemeralKey = RemoteCrypto.toBase64Url(currentEphemeral.publicKey),
                ),
            )
            logger.info(
                "remote connection handshake sent",
                mapOf("deviceId" to options.deviceId, "connectionId" to options.connectionId),
            )
        } catch (error: Throwable) {
            _state.value = RemoteConnectionState.Failed
            throw error
        }
    }

    suspend fun close() {
        if (_state.value == RemoteConnectionState.Closed) return
        _state.value = RemoteConnectionState.Closed
        keys = null
        earlySealed.clear()
        rejectPending(RemoteErrorCode.TransportClosed, "Remote connection closed")
        incomingJob?.cancelAndJoin()
        incomingJob = null
        transport.close()
    }

    suspend fun request(
        method: RemoteRequestMethod,
        payload: JsonElement? = null,
        sessionId: String? = null,
    ): JsonElement? {
        requireOnline()
        val requestId = "${options.connectionId}-${now()}-${requestCounter++}"
        val result = CompletableDeferred<JsonElement?>()
        mutex.withLock { pending[requestId] = PendingRequest(startedAt = now(), result = result) }
        try {
            sendSealed(RemoteRequest(requestId = requestId, method = method, sessionId = sessionId, payload = payload))
            return withTimeout(options.requestTimeoutMs) { result.await() }
        } catch (error: kotlinx.coroutines.TimeoutCancellationException) {
            mutex.withLock { pending.remove(requestId) }
            lastErrorCode = RemoteErrorCode.RequestTimeout
            val remoteError = RemoteError(RemoteErrorCode.RequestTimeout, "Remote request timed out", retryable = true)
            _events.emit(RemoteConnectionEvent.ErrorReceived(remoteError))
            throw RemoteRequestException(remoteError)
        } catch (error: Throwable) {
            mutex.withLock { pending.remove(requestId) }
            throw error
        }
    }

    suspend fun respond(requestId: String, payload: JsonElement?) {
        requireOnline()
        sendSealed(RemoteResponse(requestId = requestId, success = true, payload = payload))
    }

    suspend fun respond(requestId: String, error: RemoteError) {
        requireOnline()
        sendSealed(RemoteResponse(requestId = requestId, success = false, error = error))
    }

    suspend fun snapshot(): RemoteConnectionSnapshot =
        mutex.withLock {
            RemoteConnectionSnapshot(
                state = _state.value,
                deviceId = options.deviceId,
                connectionId = options.connectionId,
                peerDeviceId = peerDeviceId,
                peerIdentityKey = peerIdentityKey?.let(RemoteCrypto::toBase64Url),
                lastEventSequence = lastEventSequence,
                lastAckSequence = lastAckSequence,
                pendingRequestCount = pending.size,
                reconnectCount = reconnectCount,
                lastRttMs = lastRttMs,
                lastErrorCode = lastErrorCode,
            )
        }

    private suspend fun handleFrame(frame: RemoteFrame) {
        when (frame) {
            is RemoteHelloAck -> handleHelloAck(frame)
            is RemotePairingPending -> handlePairingPending(frame)
            is RemotePeerStatus -> {
                if (!frame.online) rejectPending(RemoteErrorCode.TransportClosed, "Remote peer is offline")
                _events.emit(RemoteConnectionEvent.PeerStatusChanged(frame.online))
            }
            is RemoteSealed -> {
                if (keys == null && isHandshaking() && earlySealed.size < EARLY_SEALED_LIMIT) {
                    earlySealed += frame
                } else {
                    handleSealed(frame)
                }
            }
            is RemoteHello,
            is RemoteRequest,
            is RemoteResponse,
            is RemoteEvent,
            is RemoteAck,
            is RemoteResume,
            -> protocolFailure("Unexpected plaintext frame after protocol v2 handshake")
        }
    }

    private suspend fun handleHelloAck(frame: RemoteHelloAck) {
        if (frame.connectionId != options.connectionId) return
        val currentEphemeral = ephemeral ?: return
        val peerIdentity = RemoteCrypto.decodePublicKey(frame.peerIdentityKey, "peerIdentityKey")
        if (!matchesExpectedPeer(peerIdentity)) {
            protocolFailure("Peer identity does not match the paired desktop")
            return
        }
        keys =
            RemoteCrypto.deriveSessionKeys(
                role = options.role,
                identity = options.identity,
                ephemeral = currentEphemeral,
                peerIdentityKey = peerIdentity,
                peerEphemeralKey = RemoteCrypto.decodePublicKey(frame.peerEphemeralKey, "peerEphemeralKey"),
            )
        peerIdentityKey = peerIdentity
        peerDeviceId = frame.peerDeviceId
        _state.value = RemoteConnectionState.Online
        logger.info(
            "remote connection online",
            mapOf("peerDeviceId" to frame.peerDeviceId, "connectionId" to options.connectionId),
        )
        val queued = earlySealed.toList()
        earlySealed.clear()
        for (sealed in queued) handleSealed(sealed)
        sendSealed(RemoteResume(lastEventSequence = lastEventSequence))
    }

    private suspend fun handlePairingPending(frame: RemotePairingPending) {
        if (frame.connectionId != options.connectionId) return
        val peerIdentity = RemoteCrypto.decodePublicKey(frame.peerIdentityKey, "peerIdentityKey")
        if (!matchesExpectedPeer(peerIdentity)) {
            protocolFailure("Pairing response came from an unexpected desktop")
            return
        }
        peerIdentityKey = peerIdentity
        peerDeviceId = frame.peerDeviceId
        _state.value = RemoteConnectionState.PendingApproval
    }

    private fun matchesExpectedPeer(peerIdentity: ByteArray): Boolean =
        options.expectedPeerIdentityKey?.let { RemoteCrypto.bytesEqual(it, peerIdentity) } ?: true

    private suspend fun handleSealed(frame: RemoteSealed) {
        val sessionKeys = keys
        if (sessionKeys == null) {
            protocolFailure("Encrypted frame arrived before the handshake completed")
            return
        }
        val inner =
            try {
                RemoteCrypto.openFrame(sessionKeys.receiveKey, frame)
            } catch (error: Throwable) {
                protocolFailure(error.message ?: "Encrypted frame could not be opened")
                return
            }
        handleSessionFrame(inner)
    }

    private suspend fun handleSessionFrame(frame: RemoteSessionFrame) {
        when (frame) {
            is RemoteRequest -> _events.emit(RemoteConnectionEvent.RequestReceived(frame))
            is RemoteResponse -> handleResponse(frame)
            is RemoteEvent -> handleEvent(frame)
            is RemoteAck -> lastAckSequence = maxOf(lastAckSequence, frame.sequence)
            is RemoteResume -> logger.debug("remote resume received", mapOf("sequence" to frame.lastEventSequence))
        }
    }

    private suspend fun handleResponse(frame: RemoteResponse) {
        val request = mutex.withLock { pending.remove(frame.requestId) }
        if (request == null) {
            logger.warn("remote response has no pending request", mapOf("requestId" to frame.requestId))
            return
        }
        lastRttMs = maxOf(0, now() - request.startedAt)
        if (frame.success) {
            request.result.complete(frame.payload)
        } else {
            val error = frame.error ?: RemoteError(RemoteErrorCode.InternalError, "Remote request failed", false)
            lastErrorCode = error.code
            _events.emit(RemoteConnectionEvent.ErrorReceived(error))
            request.result.completeExceptionally(RemoteRequestException(error))
        }
    }

    private suspend fun handleEvent(event: RemoteEvent) {
        if (event.name == RemoteEventName.SessionResync) {
            lastEventSequence = event.sequence
            if (_state.value == RemoteConnectionState.Recovering) _state.value = RemoteConnectionState.Online
            _events.emit(RemoteConnectionEvent.EventReceived(event))
            sendSealed(RemoteAck(sequence = event.sequence))
            return
        }
        if (event.sequence <= lastEventSequence) {
            logger.debug("duplicate remote event ignored", mapOf("sequence" to event.sequence, "eventId" to event.eventId))
            return
        }
        if (event.sequence != lastEventSequence + 1) {
            lastErrorCode = RemoteErrorCode.TransportClosed
            _state.value = RemoteConnectionState.Recovering
            logger.warn(
                "remote event sequence gap",
                mapOf("expected" to lastEventSequence + 1, "received" to event.sequence),
            )
            sendSealed(RemoteResume(lastEventSequence = lastEventSequence))
            return
        }
        lastEventSequence = event.sequence
        if (_state.value == RemoteConnectionState.Recovering) _state.value = RemoteConnectionState.Online
        _events.emit(RemoteConnectionEvent.EventReceived(event))
        sendSealed(RemoteAck(sequence = event.sequence))
    }

    private suspend fun sendSealed(frame: RemoteSessionFrame) {
        val sessionKeys = keys ?: error("Remote connection has no session keys")
        transport.send(RemoteCrypto.sealFrame(sessionKeys.sendKey, frame, randomBytes = options.randomBytes))
    }

    private suspend fun protocolFailure(message: String) {
        lastErrorCode = RemoteErrorCode.InvalidFrame
        val error = RemoteError(RemoteErrorCode.InvalidFrame, message, retryable = false)
        _events.emit(RemoteConnectionEvent.ErrorReceived(error))
        rejectPending(RemoteErrorCode.InvalidFrame, message)
        keys = null
        _state.value = RemoteConnectionState.Failed
        transport.close()
    }

    private suspend fun handleTransportClosed(reason: String?) {
        if (_state.value == RemoteConnectionState.Closed || _state.value == RemoteConnectionState.Failed) return
        reconnectCount += 1
        keys = null
        rejectPending(RemoteErrorCode.TransportClosed, "Remote transport closed")
        logger.warn(
            "remote transport closed",
            mapOf(
                "deviceId" to options.deviceId,
                "connectionId" to options.connectionId,
                "reason" to reason,
                "reconnectCount" to reconnectCount,
            ),
        )
        _state.value = RemoteConnectionState.Reconnecting
    }

    private suspend fun rejectPending(code: RemoteErrorCode, message: String) {
        lastErrorCode = code
        val requests = mutex.withLock { pending.values.toList().also { pending.clear() } }
        val error = RemoteRequestException(RemoteError(code, message, retryable = true))
        requests.forEach { it.result.completeExceptionally(error) }
    }

    private fun requireOnline() {
        check(_state.value == RemoteConnectionState.Online) {
            "Remote connection is ${_state.value.name.lowercase()}"
        }
    }

    private fun isHandshaking(): Boolean =
        _state.value == RemoteConnectionState.Connecting ||
            _state.value == RemoteConnectionState.Reconnecting ||
            _state.value == RemoteConnectionState.PendingApproval

    private companion object {
        const val EARLY_SEALED_LIMIT = 32
    }
}
