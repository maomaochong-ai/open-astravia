package org.vetta.android.domain.remote.pairing

import kotlin.random.Random
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.vetta.android.domain.remote.RemoteApi
import org.vetta.android.domain.remote.RemoteDevicePaired
import org.vetta.android.domain.remote.connection.NoopRemoteLogger
import org.vetta.android.domain.remote.connection.RemoteConnection
import org.vetta.android.domain.remote.connection.RemoteConnectionEvent
import org.vetta.android.domain.remote.connection.RemoteConnectionOptions
import org.vetta.android.domain.remote.connection.RemoteConnectionState
import org.vetta.android.domain.remote.connection.RemoteLogger
import org.vetta.android.domain.remote.connection.RemoteTransport
import org.vetta.android.domain.remote.isValidHostPort
import org.vetta.android.domain.remote.lanControlUrl
import org.vetta.android.domain.remote.link.RemoteTransportFactory
import org.vetta.android.domain.remote.parsePairingInvite
import org.vetta.android.domain.remote.protocol.RemoteCapabilities
import org.vetta.android.domain.remote.protocol.RemoteCrypto
import org.vetta.android.domain.remote.protocol.RemoteErrorCode
import org.vetta.android.domain.remote.protocol.RemoteEventName
import org.vetta.android.domain.remote.protocol.RemoteIdentityKeyPair
import org.vetta.android.domain.remote.protocol.RemoteRole
import org.vetta.android.domain.remote.relayControlUrl

enum class PairingFailure {
    InvalidCode,
    Rejected,
    Unauthorized,
    Unreachable,
    InvalidEndpoint,
}

enum class PairingVia {
    Lan,
    Relay,
    Manual,
}

sealed interface PairingPhase {
    data object Idle : PairingPhase

    data class Connecting(val via: PairingVia) : PairingPhase

    /** The desktop asks its user to allow this phone; both screens show [verificationCode]. */
    data class AwaitingApproval(val verificationCode: String?, val desktopName: String?) : PairingPhase

    data class Paired(val record: DesktopRecord) : PairingPhase

    data class Failed(val reason: PairingFailure) : PairingPhase
}

data class PairingFlowOptions(
    val identity: RemoteIdentityKeyPair,
    val deviceId: String,
    val deviceName: String,
    val createTransport: RemoteTransportFactory,
    val onPhase: (PairingPhase) -> Unit,
    val now: () -> Long,
    /** How long each local-network address, and a manual address, gets. */
    val timeoutMs: Long = 4_000,
    val relayTimeoutMs: Long = 8_000,
    val approvalTimeoutMs: Long = 120_000,
    val logger: RemoteLogger = NoopRemoteLogger,
)

/**
 * Turns a scanned QR code or a typed `host:port` into a desktop record (port of
 * the iOS `PairingFlow.swift`). Both paths end with a connection that reached
 * `online`; the QR path pins the desktop's identity key from the code, the
 * manual path learns it and additionally waits for the desktop to hand over
 * the long-lived credential. The connection is closed again and the long-lived
 * [DesktopLink][org.vetta.android.domain.remote.link.DesktopLink] takes over.
 */
class PairingFlow(
    private val options: PairingFlowOptions,
    private val scope: CoroutineScope,
) {
    private class Attempt(val connection: RemoteConnection, val transport: RemoteTransport) {
        var errorCode: RemoteErrorCode? = null
        val paired = CompletableDeferred<RemoteDevicePaired>()
        var watcher: Job? = null
    }

    private sealed interface Outcome {
        class Online(val attempt: Attempt) : Outcome

        class Failed(val reason: PairingFailure) : Outcome
    }

    private var cancelled = false
    private val connections = mutableListOf<RemoteConnection>()

    fun cancel() {
        cancelled = true
        val open = connections.toList()
        connections.clear()
        open.forEach { scope.launch { it.close() } }
    }

    /**
     * Tries all of the code's local-network addresses at once, then its relay. The desktop
     * lists every network card's address and most do not answer; trying them one by one
     * made a phone elsewhere (as with a connection code) wait for each to time out before
     * the relay got its turn.
     */
    suspend fun pairWithCode(text: String): DesktopRecord? {
        val invite = parsePairingInvite(text)
        if (invite == null) {
            fail(PairingFailure.InvalidCode)
            return null
        }
        val lanUrls = invite.lanEndpoints.map { lanControlUrl(it, invite.pairingId) }
        val relayUrl = invite.relayBaseUrl?.let { relayControlUrl(it, invite.pairingId) }
        if (lanUrls.isEmpty() && relayUrl == null) {
            fail(PairingFailure.InvalidCode)
            return null
        }
        val expected = RemoteCrypto.decodePublicKey(invite.desktopIdentityKey)
        var outcome: Outcome = Outcome.Failed(PairingFailure.Unreachable)
        if (lanUrls.isNotEmpty()) {
            options.onPhase(PairingPhase.Connecting(PairingVia.Lan))
            outcome = raceLan(lanUrls, invite.mobileSecret, expected)
        }
        // The desktop answered and said no; the relay would only ask again.
        val refused = (outcome as? Outcome.Failed)?.reason.let { it == PairingFailure.Unauthorized || it == PairingFailure.Rejected }
        if (outcome is Outcome.Failed && !refused && relayUrl != null && !cancelled) {
            options.onPhase(PairingPhase.Connecting(PairingVia.Relay))
            outcome = connectOnce(relayUrl, invite.mobileSecret, expected, maxOf(options.timeoutMs, options.relayTimeoutMs))
        }
        if (cancelled) {
            (outcome as? Outcome.Online)?.let { release(it.attempt) }
            return null
        }
        return when (outcome) {
            is Outcome.Online -> {
                release(outcome.attempt)
                val now = options.now()
                val record =
                    DesktopRecord(
                        desktopIdentityKey = invite.desktopIdentityKey,
                        desktopName = invite.desktopName,
                        pairingId = invite.pairingId,
                        mobileSecret = invite.mobileSecret,
                        lanEndpoints = invite.lanEndpoints,
                        relayBaseUrl = invite.relayBaseUrl,
                        pairedAt = now,
                        lastSeenAt = now,
                    )
                options.onPhase(PairingPhase.Paired(record))
                record
            }
            is Outcome.Failed -> {
                fail(outcome.reason)
                null
            }
        }
    }

    /**
     * Connects to every address at once; the first to come online wins and the rest are
     * dropped. A desktop that refuses the phone ends the race: another address is the
     * same desktop.
     */
    private suspend fun raceLan(urls: List<String>, pairingSecret: String, expected: ByteArray): Outcome =
        coroutineScope {
            val results = Channel<Outcome>(urls.size)
            val racers = urls.map { url -> launch { results.send(connectOnce(url, pairingSecret, expected, options.timeoutMs)) } }
            var result: Outcome = Outcome.Failed(PairingFailure.Unreachable)
            for (index in urls.indices) {
                val outcome = results.receive()
                if (outcome is Outcome.Online) {
                    result = outcome
                    break
                }
                val reason = (outcome as Outcome.Failed).reason
                if (reason == PairingFailure.Unauthorized || reason == PairingFailure.Rejected) {
                    result = outcome
                    break
                }
                if (reason != PairingFailure.Unreachable) result = outcome
            }
            racers.forEach(Job::cancel)
            racers.joinAll()
            // Another address may have come online in the same moment; it is not needed.
            while (true) {
                val late = results.tryReceive().getOrNull() ?: break
                if (late is Outcome.Online) release(late.attempt)
            }
            result
        }

    /**
     * Pairs with the desktop at `host:port` on the local network, without a code.
     * The desktop shows the same verification code as the phone and its user
     * allows the phone; the credential then arrives as a `device.paired` event.
     */
    suspend fun pairManually(endpoint: String): DesktopRecord? {
        val trimmed = endpoint.trim()
        if (!isValidHostPort(trimmed)) {
            fail(PairingFailure.InvalidEndpoint)
            return null
        }
        options.onPhase(PairingPhase.Connecting(PairingVia.Manual))
        val outcome = connectOnce("ws://$trimmed$MANUAL_PAIRING_PATH", pairingSecret = null, expectedPeerIdentityKey = null, timeoutMs = options.timeoutMs)
        if (outcome is Outcome.Failed) {
            fail(outcome.reason)
            return null
        }
        val attempt = (outcome as Outcome.Online).attempt
        val paired = withTimeoutOrNull(options.approvalTimeoutMs) { attempt.paired.await() }
        val peerKey = attempt.connection.snapshot().peerIdentityKey
        release(attempt)
        if (cancelled) return null
        if (paired == null || peerKey == null) {
            fail(PairingFailure.Unreachable)
            return null
        }
        val now = options.now()
        val record =
            DesktopRecord(
                desktopIdentityKey = peerKey,
                desktopName = paired.desktopName,
                pairingId = paired.pairingId,
                mobileSecret = paired.mobileSecret,
                lanEndpoints = paired.lanEndpoints.ifEmpty { listOf(trimmed) },
                relayBaseUrl = paired.relayBaseUrl,
                pairedAt = now,
                lastSeenAt = now,
            )
        options.onPhase(PairingPhase.Paired(record))
        return record
    }

    /** Connects until `online`; a failed attempt is closed again, an online one is the caller's. */
    private suspend fun connectOnce(
        url: String,
        pairingSecret: String?,
        expectedPeerIdentityKey: ByteArray?,
        timeoutMs: Long,
    ): Outcome {
        val transport = options.createTransport(url, pairingSecret)
        val connection =
            RemoteConnection(
                transport = transport,
                options =
                    RemoteConnectionOptions(
                        role = RemoteRole.Mobile,
                        deviceId = options.deviceId,
                        deviceName = options.deviceName,
                        // `screen`: the desktop captures only while the remote screen is open (ADR-0140).
                        capabilities = RemoteCapabilities(chat = true, sessionRead = true, screen = true),
                        identity = options.identity,
                        expectedPeerIdentityKey = expectedPeerIdentityKey,
                        connectionId = "mobile-${Random.nextLong().toULong().toString(16)}",
                    ),
                scope = scope,
                logger = options.logger,
                now = options.now,
            )
        connections += connection
        val attempt = Attempt(connection, transport)
        // Subscribed before connecting: `device.paired` follows the handshake immediately.
        attempt.watcher =
            scope.launch(start = CoroutineStart.UNDISPATCHED) {
                connection.events.collect { event ->
                    when (event) {
                        is RemoteConnectionEvent.ErrorReceived -> attempt.errorCode = event.error.code
                        is RemoteConnectionEvent.EventReceived ->
                            if (event.event.name == RemoteEventName.DevicePaired) {
                                RemoteApi.readDevicePaired(event.event.payload)?.let(attempt.paired::complete)
                            }
                        else -> Unit
                    }
                }
            }
        var online = false
        try {
            scope.launch {
                try {
                    connection.connect()
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Throwable) {
                    // Reported through the connection state.
                }
            }
            val reached =
                withTimeoutOrNull(timeoutMs) {
                    connection.state.first {
                        it == RemoteConnectionState.Online || it == RemoteConnectionState.PendingApproval || it in TERMINAL
                    }
                } ?: return Outcome.Failed(PairingFailure.Unreachable)
            val settled =
                if (reached == RemoteConnectionState.PendingApproval) {
                    val snapshot = connection.snapshot()
                    val code = snapshot.peerIdentityKey?.let { RemoteCrypto.verificationCode(options.identity.publicKey, RemoteCrypto.decodePublicKey(it)) }
                    options.onPhase(PairingPhase.AwaitingApproval(verificationCode = code, desktopName = snapshot.peerDeviceId))
                    withTimeoutOrNull(options.approvalTimeoutMs) {
                        connection.state.first { it != RemoteConnectionState.PendingApproval }
                    } ?: return Outcome.Failed(PairingFailure.Unreachable)
                } else {
                    reached
                }
            online = settled == RemoteConnectionState.Online
            return if (online) Outcome.Online(attempt) else Outcome.Failed(classify(attempt.errorCode ?: connection.snapshot().lastErrorCode, transport.closeReason))
        } finally {
            if (!online) release(attempt)
        }
    }

    private fun release(attempt: Attempt) {
        attempt.watcher?.cancel()
        connections.remove(attempt.connection)
        scope.launch { attempt.connection.close() }
    }

    private fun fail(reason: PairingFailure) {
        if (cancelled) return
        options.onPhase(PairingPhase.Failed(reason))
    }

    companion object {
        /** The desktop's local-network path for pairing without a code. */
        const val MANUAL_PAIRING_PATH = "/v2/lan/pair"

        private val TERMINAL =
            setOf(RemoteConnectionState.Failed, RemoteConnectionState.Reconnecting, RemoteConnectionState.Closed)

        /** The error the desktop sent, or else the reason it gave for closing the socket. */
        internal fun classify(code: RemoteErrorCode?, closeReason: String?): PairingFailure {
            if (code == RemoteErrorCode.Unauthorized) return PairingFailure.Unauthorized
            if (code == RemoteErrorCode.ApprovalRejected) return PairingFailure.Rejected
            val reason = closeReason?.lowercase().orEmpty()
            return when {
                "not approved" in reason || "rejected" in reason -> PairingFailure.Rejected
                "pinned key" in reason || "not paired" in reason || "unauthorized" in reason -> PairingFailure.Unauthorized
                else -> PairingFailure.Unreachable
            }
        }
    }
}
