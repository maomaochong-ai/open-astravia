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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import org.vetta.android.core.net.platformHttpClientEngine
import org.vetta.android.domain.remote.protocol.RemoteFrame
import org.vetta.android.domain.remote.protocol.RemoteProtocol

class KtorWebSocketRemoteTransport(
    private val url: String,
    private val pairingSecret: String,
    private val scope: CoroutineScope,
    private val client: HttpClient = HttpClient(platformHttpClientEngine()) { install(WebSockets) },
) : RemoteTransport {
    private val incomingChannel = Channel<RemoteFrame>(Channel.UNLIMITED)
    private var session: DefaultClientWebSocketSession? = null
    private var readerJob: Job? = null

    override val incoming: Flow<RemoteFrame> = incomingChannel.receiveAsFlow()

    override suspend fun connect() {
        val socket =
            client.webSocketSession {
                url.takeFrom(this@KtorWebSocketRemoteTransport.url)
                headers.append(
                    HttpHeaders.SecWebSocketProtocol,
                    listOf("vetta.remote.v2", "vetta.pairing.$pairingSecret").joinToString(", "),
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
}
