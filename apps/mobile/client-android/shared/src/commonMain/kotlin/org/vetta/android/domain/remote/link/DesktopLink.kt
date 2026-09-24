package org.vetta.android.domain.remote.link

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.vetta.android.domain.remote.RemoteApi
import org.vetta.android.domain.remote.connection.NoopRemoteLogger
import org.vetta.android.domain.remote.connection.RemoteConnection
import org.vetta.android.domain.remote.connection.RemoteConnectionEvent
import org.vetta.android.domain.remote.connection.RemoteConnectionOptions
import org.vetta.android.domain.remote.connection.RemoteConnectionState
import org.vetta.android.domain.remote.connection.RemoteLogger
import org.vetta.android.domain.remote.connection.RemoteTransport
import org.vetta.android.domain.remote.pairing.DesktopRecord
import org.vetta.android.domain.remote.relayControlUrl
import org.vetta.android.domain.remote.protocol.RemoteCapabilities
import org.vetta.android.domain.remote.protocol.RemoteCrypto
import org.vetta.android.domain.remote.protocol.RemoteErrorCode
import org.vetta.android.domain.remote.protocol.RemoteEvent
import org.vetta.android.domain.remote.protocol.RemoteEventName
import org.vetta.android.domain.remote.protocol.RemoteIdentityKeyPair
import org.vetta.android.domain.remote.protocol.RemoteRequestMethod
import org.vetta.android.domain.remote.protocol.RemoteRole
import kotlin.random.Random

/** Opens a socket to `url`, authenticated with the pairing's secret. */
typealias RemoteTransportFactory = (url: String, pairingSecret: String) -> RemoteTransport

data class DesktopLinkOptions(
    val desktop: DesktopRecord,
    val identity: RemoteIdentityKeyPair,
    val deviceId: String,
    val deviceName: String,
    val createTransport: RemoteTransportFactory,
    val now: () -> Long,
    val onSequence: (Long) -> Unit = {},
    val onLanEndpoints: (List<String>) -> Unit = {},
    val relayTimeoutMs: Long = 8_000,
    val requestTimeoutMs: Long = 30_000,
    val maxBackoffMs: Long = 30_000,
    val rttSampleIntervalMs: Long = 30_000,
    /** How long a request waits for a recovering connection to catch up. */
    val recoveryWaitMs: Long = 3_000,
    val logger: RemoteLogger = NoopRemoteLogger,
)

/**
 * One logical link to one desktop (port of the iOS `ChannelManager.swift`):
 * connects, reconnects with backoff, and keeps the event sequence across
 * connections so a reconnect never replays or drops an event.
 *
 * Every member must be used from [scope], which has to be confined to one
 * thread at a time; the state is not otherwise synchronised.
 */
class DesktopLink(
    private val options: DesktopLinkOptions,
    private val scope: CoroutineScope,
) {
    private class Candidate(val channel: LinkChannel, val connection: RemoteConnection) {
        val jobs = mutableListOf<Job>()
        var disposed = false
        var unauthorized = false
    }

    private val _snapshot = MutableStateFlow(LinkSnapshot.Offline)
    val snapshot: StateFlow<LinkSnapshot> = _snapshot.asStateFlow()

    private val _events = MutableSharedFlow<RemoteEvent>(extraBufferCapacity = EVENT_BUFFER)
    val events: SharedFlow<RemoteEvent> = _events.asSharedFlow()

    /** The last event delivered; a new connection resumes after it. */
    var sequence: Long = options.desktop.lastEventSequence
        private set

    private var lanEndpoints = options.desktop.lanEndpoints
    private var active: Candidate? = null
    private var generation = 0
    private var running = false
    private var foreground = true
    private var attemptJob: Job? = null
    private var reconnectJob: Job? = null
    private var rttJob: Job? = null
    private var backoffMs = INITIAL_BACKOFF_MS
    private var reconnectAttempt = 0

    val activeChannel: LinkChannel?
        get() = active?.channel

    fun start() {
        if (running) return
        running = true
        launchAttempt()
    }

    /** App came to the foreground or the network changed: reconnect now instead of after the backoff. */
    fun refresh() {
        foreground = true
        if (!running) return
        clearReconnect()
        backoffMs = INITIAL_BACKOFF_MS
        if (_snapshot.value.status == LinkStatus.Online) return
        launchAttempt()
    }

    fun setForeground(value: Boolean) {
        foreground = value
    }

    fun stop() {
        running = false
        generation += 1
        clearReconnect()
        attemptJob?.cancel()
        attemptJob = null
        stopRttSampling()
        active?.let(::dispose)
        active = null
        publish(LinkSnapshot.Offline)
    }

    /** @throws LinkOfflineException when there is no usable channel. */
    suspend fun request(
        method: RemoteRequestMethod,
        payload: JsonElement? = null,
        sessionId: String? = null,
    ): JsonElement? {
        val candidate = active
        if (candidate == null || !_snapshot.value.isUsable) throw LinkOfflineException()
        val connection = candidate.connection
        // A sequence gap puts the connection into `recovering` until the desktop
        // replays the missing tail, which is typical right after a (re)connect.
        // The link is still up, so wait for the replay instead of failing.
        if (connection.state.value == RemoteConnectionState.Recovering) {
            withTimeoutOrNull(options.recoveryWaitMs) {
                connection.state.first { it != RemoteConnectionState.Recovering }
            }
        }
        if (connection.state.value != RemoteConnectionState.Online) throw LinkOfflineException()
        val result = connection.request(method, payload, sessionId)
        if (active === candidate) publish(_snapshot.value.copy(rttMs = connection.snapshot().lastRttMs))
        return result
    }

    private fun launchAttempt() {
        if (attemptJob?.isActive == true) return
        attemptJob = scope.launch { attempt() }
    }

    private suspend fun attempt() {
        if (!running) return
        val current = generation
        publish(_snapshot.value.copy(status = LinkStatus.Connecting, channel = null, reconnectAttempt = reconnectAttempt))
        val relay = connectRelay(current)
        if (current != generation) {
            relay?.let(::dispose)
            return
        }
        if (relay != null) {
            adopt(relay)
            return
        }
        scheduleReconnect("unreachable")
    }

    private suspend fun connectRelay(current: Int): Candidate? {
        val relay = options.desktop.relayBaseUrl?.takeIf(String::isNotEmpty) ?: return null
        val candidate = buildCandidate(LinkChannel.Relay, relayControlUrl(relay, options.desktop.pairingId))
        var adopted = false
        try {
            adopted = waitOnline(candidate, options.relayTimeoutMs) && current == generation
            return if (adopted) candidate else null
        } finally {
            if (!adopted) dispose(candidate)
        }
    }

    private fun buildCandidate(channel: LinkChannel, url: String): Candidate {
        val connection =
            RemoteConnection(
                transport = options.createTransport(url, options.desktop.mobileSecret),
                options =
                    RemoteConnectionOptions(
                        role = RemoteRole.Mobile,
                        deviceId = options.deviceId,
                        deviceName = options.deviceName,
                        capabilities = RemoteCapabilities(chat = true, sessionRead = true),
                        identity = options.identity,
                        expectedPeerIdentityKey = RemoteCrypto.decodePublicKey(options.desktop.desktopIdentityKey),
                        connectionId = "mobile-${Random.nextLong().toULong().toString(16)}",
                        requestTimeoutMs = options.requestTimeoutMs,
                        resumeFrom = sequence,
                    ),
                scope = scope,
                logger = options.logger,
                now = options.now,
            )
        val candidate = Candidate(channel, connection)
        // Subscribed before connecting: the desktop replays from `resumeFrom` right
        // after the handshake, and those events must not be lost.
        candidate.jobs +=
            scope.launch(start = CoroutineStart.UNDISPATCHED) {
                connection.events.collect { event -> onConnectionEvent(candidate, event) }
            }
        candidate.jobs +=
            scope.launch(start = CoroutineStart.UNDISPATCHED) {
                connection.state.collect { state -> onConnectionState(candidate, state) }
            }
        return candidate
    }

    private suspend fun onConnectionEvent(candidate: Candidate, event: RemoteConnectionEvent) {
        when (event) {
            is RemoteConnectionEvent.EventReceived -> if (!candidate.disposed) deliver(event.event)
            is RemoteConnectionEvent.PeerStatusChanged ->
                if (active === candidate) publish(_snapshot.value.copy(peerOnline = event.online))
            is RemoteConnectionEvent.ErrorReceived ->
                if (event.error.code == RemoteErrorCode.Unauthorized) {
                    candidate.unauthorized = true
                    if (active === candidate) publish(_snapshot.value.copy(lastError = UNAUTHORIZED))
                }
            is RemoteConnectionEvent.RequestReceived -> Unit
        }
    }

    private fun onConnectionState(candidate: Candidate, state: RemoteConnectionState) {
        if (active !== candidate) return
        when (state) {
            RemoteConnectionState.Reconnecting,
            RemoteConnectionState.Failed,
            RemoteConnectionState.Closed,
            -> dropActive(candidate, dropReason(candidate, state))
            RemoteConnectionState.Online ->
                if (_snapshot.value.status != LinkStatus.Online) {
                    publish(_snapshot.value.copy(status = LinkStatus.Online, peerOnline = true))
                }
            else -> Unit
        }
    }

    private suspend fun waitOnline(candidate: Candidate, timeoutMs: Long): Boolean {
        candidate.jobs +=
            scope.launch {
                try {
                    candidate.connection.connect()
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Throwable) {
                    // The connection reports the failure through its state.
                }
            }
        val reached =
            withTimeoutOrNull(timeoutMs) {
                candidate.connection.state.first { it == RemoteConnectionState.Online || it in TERMINAL }
            }
        return reached == RemoteConnectionState.Online
    }

    private fun adopt(candidate: Candidate) {
        val previous = active
        active = candidate
        backoffMs = INITIAL_BACKOFF_MS
        reconnectAttempt = 0
        clearReconnect()
        previous?.let(::dispose)
        publish(
            LinkSnapshot(
                status = LinkStatus.Online,
                channel = candidate.channel,
                peerOnline = true,
                desktop = _snapshot.value.desktop,
                diagnostics = _snapshot.value.diagnostics,
                onlineSince = options.now(),
            ),
        )
        // The connection may have dropped between coming online and being adopted.
        val state = candidate.connection.state.value
        if (state != RemoteConnectionState.Online) {
            onConnectionState(candidate, state)
            return
        }
        startRttSampling()
    }

    private fun dropActive(candidate: Candidate, reason: String) {
        if (active !== candidate) return
        active = null
        stopRttSampling()
        dispose(candidate)
        publish(_snapshot.value.copy(status = LinkStatus.Offline, channel = null, peerOnline = false, lastError = reason, onlineSince = null))
        scheduleReconnect(reason)
    }

    private suspend fun deliver(event: RemoteEvent) {
        if (event.name != RemoteEventName.SessionResync && event.sequence <= sequence) return
        sequence = event.sequence
        options.onSequence(event.sequence)
        if (event.name == RemoteEventName.DeviceStatus) {
            RemoteApi.readDeviceStatus(event.payload)?.let { status ->
                if (status.lanEndpoints.isNotEmpty() && status.lanEndpoints != lanEndpoints) {
                    lanEndpoints = status.lanEndpoints
                    options.onLanEndpoints(status.lanEndpoints)
                }
                publish(_snapshot.value.copy(desktop = status))
            }
        }
        _events.emit(event)
    }

    private fun scheduleReconnect(reason: String) {
        if (!running || reconnectJob?.isActive == true) return
        reconnectAttempt += 1
        val delayMs = backoffMs
        backoffMs = minOf(options.maxBackoffMs, backoffMs * 2)
        publish(
            _snapshot.value.copy(
                status = LinkStatus.Offline,
                channel = null,
                peerOnline = false,
                lastError = reason,
                reconnectAttempt = reconnectAttempt,
                onlineSince = null,
            ),
        )
        reconnectJob =
            scope.launch {
                delay(delayMs)
                reconnectJob = null
                launchAttempt()
            }
    }

    private fun clearReconnect() {
        reconnectJob?.cancel()
        reconnectJob = null
    }

    private fun startRttSampling() {
        stopRttSampling()
        rttJob =
            scope.launch {
                sampleRtt()
                while (isActive) {
                    delay(options.rttSampleIntervalMs)
                    if (foreground && _snapshot.value.isUsable) sampleRtt()
                }
            }
    }

    /** One `diagnostics.snapshot`: its round trip is the latency, its payload the desktop's facts. */
    private suspend fun sampleRtt() {
        val candidate = active ?: return
        val result =
            try {
                candidate.connection.request(RemoteRequestMethod.DiagnosticsSnapshot)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Throwable) {
                return
            }
        if (active !== candidate) return
        publish(
            _snapshot.value.copy(
                rttMs = candidate.connection.snapshot().lastRttMs,
                diagnostics = readDiagnostics(result) ?: _snapshot.value.diagnostics,
            ),
        )
    }

    private fun stopRttSampling() {
        rttJob?.cancel()
        rttJob = null
    }

    private fun dispose(candidate: Candidate) {
        if (candidate.disposed) return
        candidate.disposed = true
        candidate.jobs.forEach(Job::cancel)
        candidate.jobs.clear()
        scope.launch { candidate.connection.close() }
    }

    private fun dropReason(candidate: Candidate, state: RemoteConnectionState): String =
        if (candidate.unauthorized) UNAUTHORIZED else state.name.lowercase()

    private fun publish(next: LinkSnapshot) {
        _snapshot.value = next
    }

    companion object {
        /** `lastError` when the desktop no longer accepts this phone's pairing. */
        const val UNAUTHORIZED = "unauthorized"

        private const val INITIAL_BACKOFF_MS = 1_000L
        private const val EVENT_BUFFER = 256
        private val TERMINAL =
            setOf(RemoteConnectionState.Failed, RemoteConnectionState.Reconnecting, RemoteConnectionState.Closed)

        private fun readDiagnostics(value: JsonElement?): DesktopDiagnostics? {
            val obj = value as? JsonObject ?: return null
            fun text(key: String) = (obj[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
            return DesktopDiagnostics(osLabel = text("osLabel"), cpu = text("cpu"), ram = text("ram"))
        }
    }
}
