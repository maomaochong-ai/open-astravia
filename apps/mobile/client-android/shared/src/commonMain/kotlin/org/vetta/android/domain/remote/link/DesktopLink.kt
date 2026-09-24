package org.vetta.android.domain.remote.link

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.joinAll
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
import org.vetta.android.domain.remote.lanControlUrl
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

/** Opens a socket to `url`, authenticated with the pairing's secret; null asks for a manual pairing. */
typealias RemoteTransportFactory = (url: String, pairingSecret: String?) -> RemoteTransport
typealias P2pRemoteTransportFactory = (target: String) -> RemoteTransport

data class DesktopLinkOptions(
    val desktop: DesktopRecord,
    val identity: RemoteIdentityKeyPair,
    val deviceId: String,
    val deviceName: String,
    val createTransport: RemoteTransportFactory,
    val createP2pTransport: P2pRemoteTransportFactory? = null,
    val p2pTarget: String? = null,
    val now: () -> Long,
    val onSequence: (Long) -> Unit = {},
    val onLanEndpoints: (List<String>) -> Unit = {},
    /** How long each local-network address gets before the relay is tried. */
    val lanBudgetMs: Long = 1_500,
    val relayTimeoutMs: Long = 8_000,
    /** While on the relay in the foreground, how often the local network is tried again. */
    val lanProbeIntervalMs: Long = 20_000,
    val p2pTimeoutMs: Long = 12_000,
    val p2pProbeIntervalMs: Long = 20_000,
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
 * The desktop's local-network addresses are raced first and the relay is the
 * bootstrap fallback. Once either is online, the link upgrades to the WebRTC
 * control DataChannel. A failed P2P link falls back and is retried in the
 * foreground.
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
    private var probeJob: Job? = null
    private var p2pJob: Job? = null
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
        if (_snapshot.value.status == LinkStatus.Online) {
            if (active?.channel == LinkChannel.Relay) launchProbe()
            if (active?.channel != LinkChannel.P2p) {
                clearP2pProbe()
                launchP2pProbe()
            }
            return
        }
        launchAttempt()
    }

    fun setForeground(value: Boolean) {
        foreground = value
        if (!value) {
            clearProbe()
            clearP2pProbe()
        } else {
            if (active?.channel == LinkChannel.Relay && probeJob?.isActive != true) scheduleProbe()
            if (active != null && active?.channel != LinkChannel.P2p) launchP2pProbe()
        }
    }

    fun stop() {
        running = false
        generation += 1
        clearReconnect()
        attemptJob?.cancel()
        attemptJob = null
        clearProbe()
        clearP2pProbe()
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
        val lan = raceLan(current)
        if (current != generation) {
            lan?.let(::dispose)
            return
        }
        if (lan != null) {
            adopt(lan)
            return
        }
        val relay = connectRelay(current)
        if (current != generation) {
            relay?.let(::dispose)
            return
        }
        if (relay != null) {
            adopt(relay)
            scheduleProbe()
            return
        }
        scheduleReconnect("unreachable")
    }

    /** Tries every local-network address at once; the first to come online wins. */
    private suspend fun raceLan(current: Int): Candidate? {
        if (lanEndpoints.isEmpty()) return null
        val candidates =
            lanEndpoints.map {
                buildCandidate(
                    LinkChannel.Lan,
                    options.createTransport(lanControlUrl(it, options.desktop.pairingId), options.desktop.mobileSecret),
                )
            }
        var winner: Candidate? = null
        try {
            winner =
                coroutineScope {
                    val first = CompletableDeferred<Candidate?>()
                    val racers =
                        candidates.map { candidate ->
                            launch { if (waitOnline(candidate, options.lanBudgetMs)) first.complete(candidate) }
                        }
                    launch {
                        racers.joinAll()
                        first.complete(null)
                    }
                    first.await().also { coroutineContext.cancelChildren() }
                }?.takeIf { current == generation }
            return winner
        } finally {
            candidates.filter { it !== winner }.forEach(::dispose)
        }
    }

    /** Probes the local network now, unless a probe or an attempt is already under way. */
    private fun launchProbe() {
        if (attemptJob?.isActive == true) return
        clearProbe()
        probeJob = scope.launch { probeLan() }
    }

    private fun scheduleProbe() {
        clearProbe()
        if (!foreground || !running || lanEndpoints.isEmpty()) return
        probeJob =
            scope.launch {
                delay(options.lanProbeIntervalMs)
                probeLan()
            }
    }

    /** On the relay: tries the local network again and moves over when it answers. */
    private suspend fun probeLan() {
        if (!running || active?.channel != LinkChannel.Relay) return
        val current = generation
        val lan = raceLan(current)
        if (lan != null && running && current == generation && active?.channel == LinkChannel.Relay) {
            adopt(lan)
            return
        }
        lan?.let(::dispose)
        if (active?.channel == LinkChannel.Relay) {
            // A fresh job, so that clearing the old one does not cancel the new schedule.
            scope.launch { scheduleProbe() }
        }
    }

    private fun clearProbe() {
        val job = probeJob
        probeJob = null
        job?.cancel()
    }

    private suspend fun connectRelay(current: Int): Candidate? {
        val relay = options.desktop.relayBaseUrl?.takeIf(String::isNotEmpty) ?: return null
        val candidate =
            buildCandidate(
                LinkChannel.Relay,
                options.createTransport(relayControlUrl(relay, options.desktop.pairingId), options.desktop.mobileSecret),
            )
        var adopted = false
        try {
            adopted = waitOnline(candidate, options.relayTimeoutMs) && current == generation
            return if (adopted) candidate else null
        } finally {
            if (!adopted) dispose(candidate)
        }
    }

    private fun buildCandidate(channel: LinkChannel, transport: RemoteTransport): Candidate {
        val connection =
            RemoteConnection(
                transport = transport,
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

    /** Upgrades an established bootstrap link to the WebRTC control DataChannel. */
    private fun launchP2pProbe() {
        if (!running || !foreground || active == null || active?.channel == LinkChannel.P2p || p2pJob?.isActive == true) return
        val factory = options.createP2pTransport ?: return
        val target = options.p2pTarget ?: return
        val current = generation
        p2pJob =
            scope.launch {
                val candidate = buildCandidate(LinkChannel.P2p, factory(target))
                var adopted = false
                try {
                    adopted = waitOnline(candidate, options.p2pTimeoutMs) && running && foreground && current == generation && active != null
                    if (adopted) {
                        p2pJob = null
                        adopt(candidate)
                        return@launch
                    }
                    dispose(candidate)
                    delay(options.p2pProbeIntervalMs)
                    p2pJob = null
                    launchP2pProbe()
                } finally {
                    if (!adopted) dispose(candidate)
                }
            }
    }

    private fun clearP2pProbe() {
        val job = p2pJob
        p2pJob = null
        job?.cancel()
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
        if (candidate.channel == LinkChannel.Lan) clearProbe()
        previous?.let(::dispose)
        val current = _snapshot.value
        publish(
            LinkSnapshot(
                status = LinkStatus.Online,
                channel = candidate.channel,
                peerOnline = true,
                desktop = current.desktop,
                diagnostics = current.diagnostics,
                // Moving from the relay to the local network continues the same session.
                rttMs = if (previous != null) current.rttMs else null,
                onlineSince = current.onlineSince?.takeIf { previous != null } ?: options.now(),
            ),
        )
        // The connection may have dropped between coming online and being adopted.
        val state = candidate.connection.state.value
        if (state != RemoteConnectionState.Online) {
            onConnectionState(candidate, state)
            return
        }
        startRttSampling()
        if (candidate.channel != LinkChannel.P2p) launchP2pProbe()
    }

    private fun dropActive(candidate: Candidate, reason: String) {
        if (active !== candidate) return
        active = null
        clearProbe()
        clearP2pProbe()
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
                    if (active?.channel == LinkChannel.Relay && probeJob?.isActive != true) scheduleProbe()
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
