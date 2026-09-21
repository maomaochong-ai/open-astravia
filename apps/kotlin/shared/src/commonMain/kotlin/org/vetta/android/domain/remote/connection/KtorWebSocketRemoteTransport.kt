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
    private val scope: CoroutineScope,
    private val client: HttpClient = HttpClient(platformHttpClientEngine()) { install(WebSockets) },
) : RemoteTransport {
    private val incomingChannel = Channel<RemoteFrame>(Channel.UNLIMITED)
    private var session: DefaultClientWebSocketSession? = null
    private var readerJob: Job? = null

    override val incoming: Flow<RemoteFrame> = incomingChannel.receiveAsFlow()

    override suspend fun connect() {
		val target = splitPairingTarget(url)
        val socket =
            client.webSocketSession {
				url.takeFrom(target.url)
				target.pairingToken?.let {
                    headers.append(
                        HttpHeaders.SecWebSocketProtocol,
						listOfNotNull("vetta.remote.v1", "vetta.pairing.$it", target.resumeToken?.let { token -> "vetta.resume.$token" }).joinToString(", "),
                    )
                }
            }
        session = socket
        readerJob?.cancel()
        readerJob =
            scope.launch {
                try {
                    for (frame in socket.incoming) {
                        if (frame is Frame.Text) incomingChannel.send(RemoteProtocol.decode(frame.readText()))
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

    private data class Target(val url: String, val pairingToken: String?, val resumeToken: String?)

    private fun splitPairingTarget(target: String): Target {
        val separator = target.indexOf('#')
		if (separator < 0) return Target(target, null, null)
		val fragment = target.substring(separator + 1)
		if (!fragment.contains('=')) return Target(target.substring(0, separator), fragment.takeIf { it.isNotEmpty() }, null)
		val values = fragment.split('&').mapNotNull {
			val index = it.indexOf('=')
			if (index <= 0) null else it.substring(0, index) to java.net.URLDecoder.decode(it.substring(index + 1), "UTF-8")
		}.toMap()
		return Target(target.substring(0, separator), values["pairing"], values["resume"])
    }
}
