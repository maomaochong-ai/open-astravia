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
import kotlinx.serialization.json.buildJsonObject
import org.vetta.android.domain.remote.connection.RemoteTransport
import org.vetta.android.domain.remote.link.RemoteTransportFactory
import org.vetta.android.domain.remote.protocol.RemoteAck
import org.vetta.android.domain.remote.protocol.RemoteCrypto
import org.vetta.android.domain.remote.protocol.RemoteError
import org.vetta.android.domain.remote.protocol.RemoteErrorCode
import org.vetta.android.domain.remote.protocol.RemoteEvent
import org.vetta.android.domain.remote.protocol.RemoteEventName
import org.vetta.android.domain.remote.protocol.RemoteFrame
import org.vetta.android.domain.remote.protocol.RemoteHello
import org.vetta.android.domain.remote.protocol.RemoteHelloAck
import org.vetta.android.domain.remote.protocol.RemoteRequest
import org.vetta.android.domain.remote.protocol.RemoteResponse
import org.vetta.android.domain.remote.protocol.RemoteResume
import org.vetta.android.domain.remote.protocol.RemoteRole
import org.vetta.android.domain.remote.protocol.RemoteSealed
import org.vetta.android.domain.remote.protocol.RemoteSessionFrame
import org.vetta.android.domain.remote.protocol.RemoteSessionKeys
import java.net.URLEncoder

/**
 * A desktop behind the relay for host tests: the real v2 handshake and
 * encryption, a scripted [handler] for requests, and an event journal that is
 * replayed after the sequence a reconnecting phone resumes from.
 */
class FakeDesktop(private val scope: CoroutineScope) {
    private val identity = RemoteCrypto.generateIdentityKeyPair()
    val identityKey: String = RemoteCrypto.toBase64Url(identity.publicKey)

    val requests = mutableListOf<RemoteRequest>()
    val opened = mutableListOf<String>()
    val hellos = mutableListOf<RemoteHello>()

    /** False makes every new socket silently swallow the phone's hello, like an absent desktop. */
    var reachable = true

    /** Rejects the phone as a revoked pairing: an `unauthorized` error, then the socket closes. */
    var rejectUnauthorized = false

    var handler: suspend FakeDesktop.(RemoteRequest) -> Unit = { respond(it.requestId, buildJsonObject {}) }

    private val journal = mutableListOf<RemoteEvent>()
    private var sequence = 0L
    private val sockets = mutableListOf<Socket>()
    private val requestSockets = mutableMapOf<String, Socket>()

    val createTransport: RemoteTransportFactory = { url, _ ->
        opened += url
        if (reachable) Socket().also { sockets += it } else DeadTransport()
    }

    val openSockets: Int
        get() = sockets.count { it.online }

    fun invite(name: String = "MacBook Pro", relay: String? = "wss://relay.example"): String =
        buildString {
            append("vetta://pair?v=2&id=$PAIRING_ID&s=$MOBILE_SECRET&k=$identityKey&n=")
            append(URLEncoder.encode(name, "UTF-8"))
            if (relay != null) append("&relay=").append(URLEncoder.encode(relay, "UTF-8"))
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

    inner class Socket : RemoteTransport {
        private val channel = Channel<RemoteFrame>(Channel.UNLIMITED)
        private val ephemeral = RemoteCrypto.generateIdentityKeyPair()
        private var keys: RemoteSessionKeys? = null
        var online = false
            private set

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
