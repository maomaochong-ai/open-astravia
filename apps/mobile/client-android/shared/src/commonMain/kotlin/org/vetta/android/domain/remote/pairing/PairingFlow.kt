package org.vetta.android.domain.remote.pairing

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.vetta.android.domain.remote.connection.NoopRemoteLogger
import org.vetta.android.domain.remote.connection.RemoteConnection
import org.vetta.android.domain.remote.connection.RemoteConnectionEvent
import org.vetta.android.domain.remote.connection.RemoteConnectionOptions
import org.vetta.android.domain.remote.connection.RemoteConnectionState
import org.vetta.android.domain.remote.connection.RemoteLogger
import org.vetta.android.domain.remote.link.RemoteTransportFactory
import org.vetta.android.domain.remote.parsePairingInvite
import org.vetta.android.domain.remote.protocol.RemoteCapabilities
import org.vetta.android.domain.remote.protocol.RemoteCrypto
import org.vetta.android.domain.remote.protocol.RemoteErrorCode
import org.vetta.android.domain.remote.protocol.RemoteIdentityKeyPair
import org.vetta.android.domain.remote.protocol.RemoteRole
import org.vetta.android.domain.remote.relayControlUrl
import kotlin.random.Random

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
    val timeoutMs: Long = 4_000,
    val relayTimeoutMs: Long = 8_000,
    val approvalTimeoutMs: Long = 120_000,
    val logger: RemoteLogger = NoopRemoteLogger,
)

/**
 * Turns a scanned QR code into a desktop record (port of the iOS `PairingFlow.swift`).
 * The path ends with a connection that reached `online` against the desktop's
 * pinned identity key; that connection is closed again and the long-lived
 * [DesktopLink][org.vetta.android.domain.remote.link.DesktopLink] takes over.
 */
class PairingFlow(
    private val options: PairingFlowOptions,
    private val scope: CoroutineScope,
) {
    private var cancelled = false
    private val connections = mutableListOf<RemoteConnection>()

    fun cancel() {
        cancelled = true
        val open = connections.toList()
        connections.clear()
        open.forEach { scope.launch { it.close() } }
    }

    suspend fun pairWithCode(text: String): DesktopRecord? {
        val invite = parsePairingInvite(text)
        if (invite == null) {
            fail(PairingFailure.InvalidCode)
            return null
        }
        val relay = invite.relayBaseUrl
        if (relay == null) {
            // Local-network pairing is not supported yet; a code without a relay cannot be reached.
            fail(PairingFailure.Unreachable)
            return null
        }
        if (cancelled) return null
        options.onPhase(PairingPhase.Connecting(PairingVia.Relay))
        val failure =
            connectOnce(
                url = relayControlUrl(relay, invite.pairingId),
                pairingSecret = invite.mobileSecret,
                expectedPeerIdentityKey = RemoteCrypto.decodePublicKey(invite.desktopIdentityKey),
                timeoutMs = maxOf(options.timeoutMs, options.relayTimeoutMs),
            )
        if (failure != null) {
            fail(failure)
            return null
        }
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
        if (cancelled) return null
        options.onPhase(PairingPhase.Paired(record))
        return record
    }

    /** Connects once and closes again; null when the desktop accepted this phone. */
    private suspend fun connectOnce(
        url: String,
        pairingSecret: String,
        expectedPeerIdentityKey: ByteArray,
        timeoutMs: Long,
    ): PairingFailure? {
        val connection =
            RemoteConnection(
                transport = options.createTransport(url, pairingSecret),
                options =
                    RemoteConnectionOptions(
                        role = RemoteRole.Mobile,
                        deviceId = options.deviceId,
                        deviceName = options.deviceName,
                        capabilities = RemoteCapabilities(chat = true, sessionRead = true),
                        identity = options.identity,
                        expectedPeerIdentityKey = expectedPeerIdentityKey,
                        connectionId = "mobile-${Random.nextLong().toULong().toString(16)}",
                    ),
                scope = scope,
                logger = options.logger,
                now = options.now,
            )
        connections += connection
        var errorCode: RemoteErrorCode? = null
        val errors =
            scope.launch(start = CoroutineStart.UNDISPATCHED) {
                connection.events.collect { event ->
                    if (event is RemoteConnectionEvent.ErrorReceived) errorCode = event.error.code
                }
            }
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
                } ?: return PairingFailure.Unreachable
            val settled =
                if (reached == RemoteConnectionState.PendingApproval) {
                    options.onPhase(PairingPhase.AwaitingApproval(verificationCode = null, desktopName = connection.snapshot().peerDeviceId))
                    withTimeoutOrNull(options.approvalTimeoutMs) {
                        connection.state.first { it != RemoteConnectionState.PendingApproval }
                    } ?: return PairingFailure.Unreachable
                } else {
                    reached
                }
            return if (settled == RemoteConnectionState.Online) null else classify(errorCode ?: connection.snapshot().lastErrorCode)
        } finally {
            errors.cancel()
            connections.remove(connection)
            scope.launch { connection.close() }
        }
    }

    private fun fail(reason: PairingFailure) {
        if (cancelled) return
        options.onPhase(PairingPhase.Failed(reason))
    }

    private companion object {
        val TERMINAL =
            setOf(RemoteConnectionState.Failed, RemoteConnectionState.Reconnecting, RemoteConnectionState.Closed)

        fun classify(code: RemoteErrorCode?): PairingFailure =
            when (code) {
                RemoteErrorCode.Unauthorized -> PairingFailure.Unauthorized
                RemoteErrorCode.ApprovalRejected -> PairingFailure.Rejected
                else -> PairingFailure.Unreachable
            }
    }
}
