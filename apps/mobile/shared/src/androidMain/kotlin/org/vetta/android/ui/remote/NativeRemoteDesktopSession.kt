package org.vetta.android.ui.remote

import android.content.Context
import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.http.HttpHeaders
import io.ktor.http.takeFrom
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.put
import org.vetta.android.domain.remote.connection.PlatformRemoteLogger
import org.webrtc.DataChannel
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

private const val PROTOCOL_VERSION = 1
private const val INPUT_CHANNEL = "vetta-input-v1"

class NativeRemoteDesktopSession(private val context: Context, private val target: String) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val json = Json { ignoreUnknownKeys = true }
    private val client = HttpClient { install(WebSockets) }
    private val eglBase = EglBase.create()
    private var factory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var signalingJob: Job? = null
    private var signaling: DefaultClientWebSocketSession? = null
    private var inputChannel: DataChannel? = null
    private var sequence = 1L
    private var renderer: SurfaceViewRenderer? = null
    private var stopped = false
    private var remoteDescriptionSet = false
    private val pendingCandidates = mutableListOf<IceCandidate>()

    fun createRenderer(): SurfaceViewRenderer = SurfaceViewRenderer(context).also {
        renderer = it
        it.init(eglBase.eglBaseContext, null)
        it.setEnableHardwareScaler(true)
        it.setScalingType(org.webrtc.RendererCommon.ScalingType.SCALE_ASPECT_FIT)
    }

    fun start() {
        if (signalingJob != null) return
        stopped = false
        signalingJob = scope.launch { run() }
    }

    fun stop() {
        if (stopped) return
        stopped = true
        signalingJob?.cancel()
        signalingJob = null
        inputChannel?.dispose()
        peerConnection?.dispose()
        factory?.dispose()
        signaling?.cancel()
        renderer?.release()
        eglBase.release()
        client.close()
        scope.cancel()
    }

    fun pauseRenderer() = renderer?.pauseVideo()

    fun resumeRenderer() = renderer?.disableFpsReduction()

    fun sendPointer(type: String, x: Float, y: Float, button: String? = null, action: String? = null) {
        sendInput(buildJsonObject {
            put("type", type)
            put("sequence", sequence++)
            put("x", x.coerceIn(0f, 1f))
            put("y", y.coerceIn(0f, 1f))
            if (button != null) put("button", button)
            if (action != null) put("action", action)
        })
    }

    fun sendScroll(deltaX: Float, deltaY: Float) {
        sendInput(buildJsonObject {
            put("type", "pointer.scroll")
            put("sequence", sequence++)
            put("deltaX", deltaX)
            put("deltaY", deltaY)
        })
    }

    fun sendKey(code: String, action: String) {
        sendInput(buildJsonObject {
            put("type", "key")
            put("sequence", sequence++)
            put("code", code)
            put("action", action)
        })
    }

    private fun sendInput(payload: JsonObject) {
        val channel = inputChannel ?: return
        if (channel.state() != DataChannel.State.OPEN) return
        channel.send(DataChannel.Buffer(java.nio.ByteBuffer.wrap(payload.toString().toByteArray()), false))
    }

    private suspend fun run() {
        try {
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions(),
            )
            factory = PeerConnectionFactory.builder()
                .setVideoDecoderFactory(org.webrtc.DefaultVideoDecoderFactory(eglBase.eglBaseContext))
                .setVideoEncoderFactory(org.webrtc.DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
                .createPeerConnectionFactory()
            val (socketUrl, token) = splitTarget(target)
            val socket = client.webSocketSession {
                url.takeFrom(socketUrl)
                headers.append(HttpHeaders.SecWebSocketProtocol, listOf("vetta.desktop.v1", "vetta.pairing.$token").joinToString(", "))
            }
            signaling = socket
            createPeerConnection()
            for (frame in socket.incoming) if (frame is Frame.Text) handleSignal(frame.readText())
        } catch (error: Throwable) {
            if (!stopped) PlatformRemoteLogger.warn("native WebRTC session failed", mapOf("error" to (error.message ?: error::class.simpleName)))
        }
    }

    private fun createPeerConnection() {
        val configuration = PeerConnection.RTCConfiguration(listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
        ))
        configuration.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        peerConnection = factory?.createPeerConnection(configuration, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) = Unit
            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) = Unit
            override fun onIceCandidate(candidate: IceCandidate) = sendSignal(candidateSignal(candidate))
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
            override fun onAddStream(stream: MediaStream) = Unit
            override fun onRemoveStream(stream: MediaStream) = Unit
            override fun onDataChannel(channel: DataChannel) { if (channel.label() == INPUT_CHANNEL) inputChannel = channel }
            override fun onRenegotiationNeeded() = Unit
            override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) {
                (receiver.track() as? VideoTrack)?.addSink(renderer)
            }
        })
    }

    private fun handleSignal(raw: String) {
        for (line in raw.split('\n').filter { it.isNotBlank() }) {
            val signal = json.parseToJsonElement(line).jsonObject
            when (signal["type"]?.jsonPrimitive?.contentOrNull) {
                "offer" -> {
                    val sdp = signal["sdp"]?.jsonPrimitive?.content ?: return
                    peerConnection?.setRemoteDescription(object : SdpObserver by LoggingSdpObserver {
                        override fun onSetSuccess() {
                            remoteDescriptionSet = true
                            pendingCandidates.forEach { peerConnection?.addIceCandidate(it) }
                            pendingCandidates.clear()
                            peerConnection?.createAnswer(object : SdpObserver by LoggingSdpObserver {
                                override fun onCreateSuccess(description: SessionDescription) {
                                    peerConnection?.setLocalDescription(LoggingSdpObserver, description)
                                    sendSignal(buildJsonObject {
                                        put("type", "answer")
                                        put("protocolVersion", PROTOCOL_VERSION)
                                        put("sessionId", sessionId())
                                        put("sdp", description.description)
                                    })
                                }
                            }, MediaConstraints())
                        }
                    }, SessionDescription(SessionDescription.Type.OFFER, sdp))
                }
                "ice" -> {
                    val candidate = IceCandidate(
                        signal["sdpMid"]?.jsonPrimitive?.contentOrNull,
                        signal["sdpMLineIndex"]?.jsonPrimitive?.int ?: 0,
                        signal["candidate"]?.jsonPrimitive?.content ?: return,
                    )
                    if (remoteDescriptionSet) peerConnection?.addIceCandidate(candidate) else pendingCandidates += candidate
                }
            }
        }
    }

    private fun sendSignal(signal: JsonObject) {
        scope.launch { signaling?.send(Frame.Text(signal.toString() + "\n")) }
    }

    private fun candidateSignal(candidate: IceCandidate) = buildJsonObject {
        put("type", "ice")
        put("protocolVersion", PROTOCOL_VERSION)
        put("sessionId", sessionId())
        put("candidate", candidate.sdp)
        candidate.sdpMid?.let { put("sdpMid", it) }
        put("sdpMLineIndex", candidate.sdpMLineIndex)
    }

    private fun sessionId(): String = Regex("/v1/desktop/([A-Za-z0-9_-]{24,128})/").find(target)?.groupValues?.get(1).orEmpty()

    private fun splitTarget(value: String): Pair<String, String> {
        val index = value.indexOf('#')
        if (index < 0) return value to ""
        val fragment = value.substring(index + 1)
        val token = if (fragment.contains('=')) android.net.Uri.decode(fragment.substringAfter("pairing=").substringBefore('&')) else fragment
        return value.substring(0, index) to token
    }

    private object LoggingSdpObserver : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription) = Unit
        override fun onSetSuccess() = Unit
        override fun onCreateFailure(error: String) { PlatformRemoteLogger.warn("native WebRTC SDP create failed", mapOf("error" to error)) }
        override fun onSetFailure(error: String) { PlatformRemoteLogger.warn("native WebRTC SDP set failed", mapOf("error" to error)) }
    }
}
