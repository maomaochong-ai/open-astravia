package org.vetta.android.domain.work

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.vetta.android.domain.remote.connection.RemoteTransport
import org.vetta.android.domain.remote.connection.UnknownPairingException
import org.vetta.android.domain.remote.link.RemoteTransportFactory
import org.vetta.android.domain.remote.pairing.PairingFlow
import org.vetta.android.domain.remote.protocol.RemoteAck
import org.vetta.android.domain.remote.protocol.RemoteCrypto
import org.vetta.android.domain.remote.protocol.RemoteError
import org.vetta.android.domain.remote.protocol.RemoteErrorCode
import org.vetta.android.domain.remote.protocol.RemoteEvent
import org.vetta.android.domain.remote.protocol.RemoteEventName
import org.vetta.android.domain.remote.protocol.RemoteFrame
import org.vetta.android.domain.remote.protocol.RemoteHello
import org.vetta.android.domain.remote.protocol.RemoteHelloAck
import org.vetta.android.domain.remote.protocol.RemotePairingPending
import org.vetta.android.domain.remote.protocol.RemoteRequest
import org.vetta.android.domain.remote.protocol.RemoteResponse
import org.vetta.android.domain.remote.protocol.RemoteResume
import org.vetta.android.domain.remote.protocol.RemoteRole
import org.vetta.android.domain.remote.protocol.RemoteSealed
import org.vetta.android.domain.remote.protocol.RemoteSessionFrame
import org.vetta.android.domain.remote.protocol.RemoteSessionKeys
import java.net.URLEncoder

/**
 * A desktop for host tests, behind the relay and on the local network at
 * [LAN_ENDPOINT]: the real v2 handshake and encryption, a scripted [handler]
 * for requests, an event journal that is replayed after the sequence a
 * reconnecting phone resumes from, and manual pairing that waits for [approveManual].
 */
class FakeDesktop(private val scope: CoroutineScope) {
    private val identity = RemoteCrypto.generateIdentityKeyPair()
    val identityKey: String = RemoteCrypto.toBase64Url(identity.publicKey)

    val requests = mutableListOf<RemoteRequest>()
    val opened = mutableListOf<String>()
    val hellos = mutableListOf<RemoteHello>()

    /** False makes every new socket silently swallow the phone's hello, like an absent desktop. */
    var reachable = true

    /** False makes the local-network addresses unreachable, as from another network. */
    var lanReachable = true

    /** The local server answers that it does not know this pairing, as after unpairing on the desktop. */
    var forgotPairing = false

    /** Rejects the phone as a revoked pairing: an `unauthorized` error, then the socket closes. */
    var rejectUnauthorized = false

    /** The pairing secret each socket was opened with; null for a manual pairing. */
    val secrets = mutableListOf<String?>()

    /** The manual pairing waiting for this desktop's user to allow it. */
    var awaitingApproval: Socket? = null
        private set

    var handler: suspend FakeDesktop.(RemoteRequest) -> Unit = { respond(it.requestId, buildJsonObject {}) }

    private val journal = mutableListOf<RemoteEvent>()
    private var sequence = 0L

    /** The last event this desktop sent. */
    val lastSequence: Long
        get() = sequence

    private val sockets = mutableListOf<Socket>()
    private val requestSockets = mutableMapOf<String, Socket>()

    val createTransport: RemoteTransportFactory = { url, secret ->
        opened += url
        secrets += secret
        val lan = url.startsWith("ws://")
        when {
            lan && forgotPairing -> ForgottenTransport()
            reachable && (!lan || lanReachable) -> Socket(manual = url.endsWith(PairingFlow.MANUAL_PAIRING_PATH)).also { sockets += it }
            else -> DeadTransport()
        }
    }

    val lanOpened: List<String>
        get() = opened.filter { it.startsWith("ws://") }

    val openSockets: Int
        get() = sockets.count { it.online }

    fun invite(name: String = "MacBook Pro", relay: String? = "wss://relay.example", lan: List<String> = emptyList()): String =
        buildString {
            append("vetta://pair?v=2&id=$PAIRING_ID&s=$MOBILE_SECRET&k=$identityKey&n=")
            append(URLEncoder.encode(name, "UTF-8"))
            if (relay != null) append("&relay=").append(URLEncoder.encode(relay, "UTF-8"))
            if (lan.isNotEmpty()) append("&lan=").append(URLEncoder.encode(lan.joinToString(","), "UTF-8"))
        }

    /** The desktop's user allows the manual pairing; the credential follows the handshake. */
    suspend fun approveManual(name: String = "MacBook Pro") {
        val socket = checkNotNull(awaitingApproval) { "no manual pairing is waiting" }
        awaitingApproval = null
        socket.accept()
        socket.sendSession(
            RemoteEvent(
                eventId = "event-paired",
                sequence = 1,
                name = RemoteEventName.DevicePaired,
                payload =
                    buildJsonObject {
                        put("pairingId", PAIRING_ID)
                        put("mobileSecret", MOBILE_SECRET)
                        put("desktopName", name)
                        put("lanEndpoints", buildJsonArray { add(LAN_ENDPOINT) })
                        put("relayBaseUrl", "wss://relay.example")
                    },
            ),
        )
    }

    /** The desktop's user declines the manual pairing: the socket closes with a reason. */
    fun declineManual() {
        val socket = checkNotNull(awaitingApproval) { "no manual pairing is waiting" }
        awaitingApproval = null
        socket.closeReason = "pairing not approved"
        socket.drop()
    }

    suspend fun respond(requestId: String, payload: JsonElement?) {
        requestSockets.remove(requestId)?.sendSession(RemoteResponse(requestId, success = true, payload = payload))
    }

    suspend fun fail(requestId: String, code: RemoteErrorCode, message: String) {
        requestSockets.remove(requestId)?.sendSession(RemoteResponse(requestId, success = false, error = RemoteError(code, message, retryable = false)))
    }

    /** Journals an event and sends it to every phone that is online. */
    suspend fun emit(name: RemoteEventName, payload: JsonObject, sessionId: String? = null) {
        sequence += 1
        val event = RemoteEvent(eventId = "event-$sequence", sequence = sequence, name = name, sessionId = sessionId, payload = payload)
        journal += event
        sockets.filter { it.online }.forEach { it.sendSession(event) }
    }

    /** Journals an event without delivering it, as if the phone was away when it happened. */
    fun journalWhileAway(name: RemoteEventName, payload: JsonObject, sessionId: String? = null) {
        sequence += 1
        journal += RemoteEvent(eventId = "event-$sequence", sequence = sequence, name = name, sessionId = sessionId, payload = payload)
    }

    /** The network drops: every open socket closes under the phone. */
    fun dropConnections() {
        sockets.forEach { it.drop() }
        sockets.clear()
    }

    inner class Socket(private val manual: Boolean = false) : RemoteTransport {
        private val channel = Channel<RemoteFrame>(Channel.UNLIMITED)
        private val ephemeral = RemoteCrypto.generateIdentityKeyPair()
        private var keys: RemoteSessionKeys? = null
        private var hello: RemoteHello? = null
        var online = false
            private set

        override var closeReason: String? = null

        override val incoming: Flow<RemoteFrame> = channel.receiveAsFlow()

        override suspend fun connect() = Unit

        override suspend fun send(frame: RemoteFrame) {
            when (frame) {
                is RemoteHello -> handshake(frame)
                is RemoteSealed -> {
                    val sessionKeys = keys ?: return
                    when (val inner = RemoteCrypto.openFrame(sessionKeys.receiveKey, frame)) {
                        is RemoteRequest -> {
                            requests += inner
                            requestSockets[inner.requestId] = this
                            scope.launch { handler(inner) }
                        }
                        is RemoteResume -> journal.filter { it.sequence > inner.lastEventSequence }.forEach { sendSession(it) }
                        is RemoteAck, is RemoteResponse, is RemoteEvent -> Unit
                    }
                }
                else -> error("Protocol v2 phone sent a plaintext ${frame::class.simpleName}")
            }
        }

        private suspend fun handshake(hello: RemoteHello) {
            hellos += hello
            if (rejectUnauthorized) {
                drop()
                return
            }
            this.hello = hello
            if (manual) {
                awaitingApproval = this
                channel.send(RemotePairingPending(connectionId = hello.connectionId, peerDeviceId = "desktop-1", peerIdentityKey = identityKey))
                return
            }
            accept()
        }

        suspend fun accept() {
            val hello = checkNotNull(hello)
            keys =
                RemoteCrypto.deriveSessionKeys(
                    role = RemoteRole.Desktop,
                    identity = identity,
                    ephemeral = ephemeral,
                    peerIdentityKey = RemoteCrypto.decodePublicKey(hello.identityKey),
                    peerEphemeralKey = RemoteCrypto.decodePublicKey(hello.ephemeralKey),
                )
            online = true
            channel.send(
                RemoteHelloAck(
                    connectionId = hello.connectionId,
                    peerDeviceId = "desktop-1",
                    peerIdentityKey = identityKey,
                    peerEphemeralKey = RemoteCrypto.toBase64Url(ephemeral.publicKey),
                ),
            )
        }

        suspend fun sendSession(frame: RemoteSessionFrame) {
            val sessionKeys = keys ?: return
            if (!online) return
            channel.send(RemoteCrypto.sealFrame(sessionKeys.sendKey, frame))
        }

        fun drop() {
            online = false
            channel.close()
        }

        override suspend fun close() {
            online = false
            channel.close()
        }
    }

    private class ForgottenTransport : RemoteTransport {
        override val incoming: Flow<RemoteFrame> = Channel<RemoteFrame>().receiveAsFlow()

        override suspend fun connect() {
            throw UnknownPairingException(IllegalStateException("Expected HTTP 101 response but was '404 unknown pairing'"))
        }

        override suspend fun send(frame: RemoteFrame) = Unit

        override suspend fun close() = Unit
    }

    private class DeadTransport : RemoteTransport {
        private val channel = Channel<RemoteFrame>()
        override val incoming: Flow<RemoteFrame> = channel.receiveAsFlow()

        override suspend fun connect() = Unit

        override suspend fun send(frame: RemoteFrame) = Unit

        override suspend fun close() {
            channel.close()
        }
    }

    companion object {
        const val PAIRING_ID = "pair-1234567890abcdef"
        const val MOBILE_SECRET = "secret-1234567890abcdef"
        const val LAN_ENDPOINT = "192.168.1.20:43117"
    }
}

/** Advances virtual time in small steps until `check` holds; fails the caller's assertion otherwise. */
fun TestScope.eventually(timeoutMs: Long = 5_000, check: () -> Boolean): Boolean {
    var waited = 0L
    runCurrent()
    while (!check()) {
        if (waited >= timeoutMs) return false
        advanceTimeBy(STEP_MS)
        runCurrent()
        waited += STEP_MS
    }
    return true
}

private const val STEP_MS = 10L
