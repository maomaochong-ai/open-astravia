package org.vetta.android.domain.remote.connection

import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.http.HttpHeaders
import io.ktor.http.takeFrom
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.vetta.android.core.net.platformHttpClientEngine
import org.vetta.android.domain.remote.protocol.RemoteFrame
import org.vetta.android.domain.remote.protocol.RemoteProtocol

/**
 * One WebSocket to the desktop or the relay. The subprotocol header carries the
 * pairing secret; without one ([pairingSecret] null) the socket asks for a
 * manual pairing, which the desktop only accepts on its `/v2/lan/pair` path.
 */
class KtorWebSocketRemoteTransport(
    private val url: String,
    private val pairingSecret: String?,
    private val scope: CoroutineScope,
    private val client: HttpClient = HttpClient(platformHttpClientEngine()) { install(WebSockets) },
) : RemoteTransport {
    private val incomingChannel = Channel<RemoteFrame>(Channel.UNLIMITED)
    private var session: DefaultClientWebSocketSession? = null
    private var readerJob: Job? = null

    override val incoming: Flow<RemoteFrame> = incomingChannel.receiveAsFlow()

    override var closeReason: String? = null
        private set

    override suspend fun connect() {
        val socket =
            client.webSocketSession {
                url.takeFrom(this@KtorWebSocketRemoteTransport.url)
                headers.append(
                    HttpHeaders.SecWebSocketProtocol,
                    listOf(PROTOCOL, pairingSecret?.let { "$PAIRING_PREFIX$it" } ?: MANUAL).joinToString(", "),
                )
            }
        session = socket
        readerJob?.cancel()
        readerJob =
            scope.launch {
                try {
                    for (frame in socket.incoming) {
                        if (frame is Frame.Text) {
                            for (line in frame.readText().split('\n').filter(String::isNotBlank)) {
                                if (line == "ping" || line == "pong") continue
                                incomingChannel.send(RemoteProtocol.decode(line))
                            }
                        }
                    }
                    // Recorded before `incoming` ends, so whoever sees the end can read it.
                    closeReason = withTimeoutOrNull(CLOSE_REASON_WAIT_MS) { socket.closeReason.await() }?.message
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (error: Throwable) {
                    // A dropped network fails the read; that is this link closing, not a crash.
                    closeReason = error.message ?: "remote websocket failed"
                } finally {
                    incomingChannel.close()
                }
            }
    }

    override suspend fun send(frame: RemoteFrame) {
        session?.send(Frame.Text(RemoteProtocol.encode(frame)))
            ?: error("remote websocket is not connected")
    }

    override suspend fun close() {
        readerJob?.cancel()
        readerJob = null
        session?.close()
        session = null
        client.close()
    }

    private companion object {
        const val PROTOCOL = "vetta.remote.v2"
        const val PAIRING_PREFIX = "vetta.pairing."
        const val MANUAL = "vetta.manual"
        const val CLOSE_REASON_WAIT_MS = 500L
    }
}
