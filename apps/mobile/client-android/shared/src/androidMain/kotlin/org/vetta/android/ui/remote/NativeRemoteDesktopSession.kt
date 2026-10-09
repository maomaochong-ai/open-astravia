package org.vetta.android.ui.remote

import android.content.Context
import androidx.compose.ui.unit.IntSize
import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.http.HttpHeaders
import io.ktor.http.takeFrom
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.vetta.android.domain.remote.RemoteStreamStats
import org.vetta.android.domain.remote.SignalingDrop
import org.vetta.android.domain.remote.SignalingRetry
import org.vetta.android.domain.remote.connection.PlatformRemoteLogger
import org.vetta.android.domain.remote.connection.RemoteTransport
import org.vetta.android.domain.remote.protocol.RemoteFrame
import org.vetta.android.domain.remote.protocol.RemoteProtocol
import org.webrtc.DataChannel
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RendererCommon
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

private const val PROTOCOL_VERSION = 1
private const val INPUT_CHANNEL = "vetta-input-v1"
private const val CONTROL_CHANNEL = "vetta-control-v2"

/** Opened by desktops that send the picture no larger than this phone shows it. */
private const val VIEW_CHANNEL = "vetta-view-v1"
private const val MAX_CONTROL_MESSAGE_BYTES = 1_500_000
private const val TRACE_STEPS = 8

/**
 * STUN only, no TURN (ADR-0135), and only servers reachable in mainland China without a
 * proxy: one a proxy carries (Google, Cloudflare) can answer first with the proxy's exit
 * as this phone's address, and the link then goes through it. Kept in step with the
 * desktop's `REMOTE_DESKTOP_ICE_SERVERS`.
 */
private val ICE_SERVERS = listOf(
    listOf("stun:stun.miwifi.com:3478", "stun:stun.chat.bilibili.com:3478", "stun:stun.hitv.com:3478"),
)

/**
 * Shows each frame as soon as it is decoded. WebRTC's default jitter buffer smooths
 * playback for video calls, and a desktop's bursty frames (tiny while still, hundreds
 * of KB when a window moves) made it hold frames 100 to 300 ms on a 1 ms network.
 * The factory reads its own trials: set only through `initialize`, this one was ignored.
 */
private const val FIELD_TRIALS = "WebRTC-ForcePlayoutDelay/min_ms:0,max_ms:0/"

/**
 * One WebRTC session with the paired desktop, set up through the relay's viewer signaling.
 * Once connected directly it no longer needs the relay: if signaling drops (the relay
 * restarts, say) it reopens in the background and the link stays up.
 */
class NativeRemoteDesktopSession(private val context: Context, private val target: String) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val json = Json { ignoreUnknownKeys = true }
    private val client = HttpClient { install(WebSockets) }
    private val eglBase = EglBase.create()
    private var factory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var signalingJob: Job? = null
    @Volatile private var signaling: DefaultClientWebSocketSession? = null
    private var inputChannel: DataChannel? = null
    private var controlChannel: DataChannel? = null
    private var controlTransport: NativeRemoteControlTransport? = null
    private var viewChannel: DataChannel? = null

    /** How large the whole desktop is shown, in pixels with zoom applied; sent again once the channel opens. */
    @Volatile private var shown: IntSize? = null
    private var sequence = 1L
    private var renderer: SurfaceViewRenderer? = null
    private var remoteVideoTrack: VideoTrack? = null
    private val _stopped = MutableStateFlow(false)
    private var stopped: Boolean
        get() = _stopped.value
        set(value) {
            _stopped.value = value
        }
    private var remoteDescriptionSet = false
    private val pendingCandidates = mutableListOf<IceCandidate>()
    private val signalingRetry = SignalingRetry()

    /** ICE reached the desktop; set from WebRTC's thread. */
    @Volatile private var directlyConnected = false

    val isStopped: Boolean
        get() = stopped

    /** True once the session has ended and released its video; a viewer then needs a new one. */
    val stoppedState: StateFlow<Boolean> = _stopped

    private val _frameSize = MutableStateFlow<IntSize?>(null)

    /** The stream's picture as shown, rotation applied; null until the first frame. */
    val frameSize: StateFlow<IntSize?> = _frameSize

    private val _stats = MutableStateFlow<RemoteStreamStats?>(null)

    /** How the picture travels right now, refreshed every second while connected. */
    val stats: StateFlow<RemoteStreamStats?> = _stats
    private var statsJob: Job? = null

    private val _trace = MutableStateFlow<List<String>>(emptyList())

    /**
     * The last steps of setting up the connection, newest last, for a page stuck connecting.
     * Technical names only: never SDP, candidates or the pairing secret.
     */
    val trace: StateFlow<List<String>> = _trace

    /** The running totals at the last sample, to average over the last second only. */
    private var lastTotals: RemoteStreamStats.FrameTotals? = null

    fun createControlTransport(): RemoteTransport {
        check(controlTransport == null) { "remote desktop control transport already claimed" }
        return NativeRemoteControlTransport(this).also { transport ->
            controlTransport = transport
            controlChannel?.let(transport::bind)
        }
    }

    fun createRenderer(): SurfaceViewRenderer = SurfaceViewRenderer(context).also {
        // A stopped session has released its EGL context; a blank view stands in until the viewer moves on.
        if (stopped) return@also
        renderer = it
        it.init(
            eglBase.eglBaseContext,
            object : RendererCommon.RendererEvents {
                override fun onFirstFrameRendered() = Unit

                // Called on the render thread; a StateFlow may be set from any thread.
                override fun onFrameResolutionChanged(width: Int, height: Int, rotation: Int) {
                    _frameSize.value = if (rotation % 180 == 0) IntSize(width, height) else IntSize(height, width)
                }
            },
        )
        it.setEnableHardwareScaler(true)
        it.setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
        remoteVideoTrack?.addSink(it)
    }

    fun start() {
        if (signalingJob != null) return
        stopped = false
        signalingJob = scope.launch { run() }
    }

    fun stop() {
        if (stopped) return
        note("stopped")
        stopped = true
        signalingJob?.cancel()
        signalingJob = null
        statsJob?.cancel()
        statsJob = null
        _stats.value = null
        inputChannel?.dispose()
        controlChannel?.dispose()
        viewChannel?.dispose()
        peerConnection?.dispose()
        factory?.dispose()
        signaling?.cancel()
        renderer?.let { remoteVideoTrack?.removeSink(it) }
        remoteVideoTrack = null
        renderer?.release()
        renderer = null
        eglBase.release()
        client.close()
        scope.cancel()
        controlTransport?.channelClosed("remote desktop session stopped")
    }

    /**
     * The view showing the picture is gone (the screen closed or moved to another session):
     * it stops taking frames and lets go of its EGL surface. Left attached, each closed
     * screen kept a renderer decoding into nothing for as long as the session lived.
     */
    fun releaseRenderer(view: SurfaceViewRenderer) {
        remoteVideoTrack?.removeSink(view)
        if (renderer === view) renderer = null
        view.release()
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

    /** Types text as-is; desktops before this message ignore it. */
    fun sendText(text: String) {
        sendInput(buildJsonObject {
            put("type", "text")
            put("sequence", sequence++)
            put("text", text)
        })
    }

    /**
     * Tells the desktop how large the whole picture is shown, zoom included, so it sends no
     * more detail than that. Desktops that do not open the view channel keep the full size.
     */
    fun showView(size: IntSize) {
        if (size.width <= 0 || size.height <= 0) return
        shown = size
        sendView()
    }

    private fun sendView() {
        val size = shown ?: return
        val channel = viewChannel ?: return
        if (channel.state() != DataChannel.State.OPEN) return
        val payload = buildJsonObject {
            put("width", size.width)
            put("height", size.height)
        }
        channel.send(DataChannel.Buffer(java.nio.ByteBuffer.wrap(payload.toString().toByteArray()), false))
    }

    private fun sendInput(payload: JsonObject) {
        val channel = inputChannel ?: return
        if (channel.state() != DataChannel.State.OPEN) return
        channel.send(DataChannel.Buffer(java.nio.ByteBuffer.wrap(payload.toString().toByteArray()), false))
    }

    private suspend fun run() {
        try {
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(context).setFieldTrials(FIELD_TRIALS).createInitializationOptions(),
            )
            factory = PeerConnectionFactory.builder()
                .setFieldTrials(FIELD_TRIALS)
                .setVideoDecoderFactory(org.webrtc.DefaultVideoDecoderFactory(eglBase.eglBaseContext))
                .setVideoEncoderFactory(org.webrtc.DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
                .createPeerConnectionFactory()
            val (socketUrl, token) = splitTarget(target)
            while (!stopped) {
                try {
                    note(if (peerConnection == null) "signaling connecting" else "signaling reconnecting")
                    val socket = client.webSocketSession {
                        url.takeFrom(socketUrl)
                        headers.append(HttpHeaders.SecWebSocketProtocol, listOf("vetta.desktop.v1", "vetta.pairing.$token").joinToString(", "))
                    }
                    signaling = socket
                    signalingRetry.reopened()
                    note("signaling open")
                    PlatformRemoteLogger.info("native WebRTC signaling connected")
                    if (peerConnection == null) createPeerConnection()
                    for (frame in socket.incoming) if (frame is Frame.Text) handleSignal(frame.readText())
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Throwable) {
                    // Before the direct link is up the session cannot go on without signaling.
                    if (stopped || !directlyConnected) throw error
                    PlatformRemoteLogger.warn("native WebRTC signaling lost", mapOf("error" to (error.message ?: error::class.simpleName)))
                }
                signaling?.cancel()
                signaling = null
                if (stopped) break
                when (val drop = signalingRetry.dropped(directlyConnected)) {
                    SignalingDrop.Stop -> break
                    is SignalingDrop.Reconnect -> {
                        note("signaling lost, direct link kept")
                        delay(drop.afterMs)
                    }
                }
                if (!directlyConnected) break
            }
        } catch (error: Throwable) {
            if (!stopped) {
                note("failed: ${error::class.simpleName}")
                PlatformRemoteLogger.warn("native WebRTC session failed", mapOf("error" to (error.message ?: error::class.simpleName)))
            }
        } finally {
            controlTransport?.channelClosed("remote desktop signaling closed")
            if (!stopped) stop()
        }
    }

    private fun createPeerConnection() {
        val configuration = PeerConnection.RTCConfiguration(ICE_SERVERS.map { PeerConnection.IceServer.builder(it).createIceServer() })
        configuration.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        peerConnection = factory?.createPeerConnection(configuration, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                note("ICE ${state.name.lowercase()}")
                PlatformRemoteLogger.info("native WebRTC ICE state", mapOf("state" to state.name))
                if (state == PeerConnection.IceConnectionState.CONNECTED || state == PeerConnection.IceConnectionState.COMPLETED) {
                    directlyConnected = true
                    scope.launch { sampleStats() }
                }
                if (state == PeerConnection.IceConnectionState.FAILED || state == PeerConnection.IceConnectionState.CLOSED) {
                    directlyConnected = false
                    controlTransport?.channelClosed("WebRTC ICE ${state.name.lowercase()}")
                    // With signaling away nothing else would end this session.
                    if (signaling == null) scope.launch { stop() }
                }
            }
            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) = Unit
            override fun onIceCandidate(candidate: IceCandidate) = sendSignal(candidateSignal(candidate))
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
            override fun onAddStream(stream: MediaStream) = Unit
            override fun onRemoveStream(stream: MediaStream) = Unit
            override fun onDataChannel(channel: DataChannel) {
                note("channel ${channel.label()} open")
                when (channel.label()) {
                    INPUT_CHANNEL -> inputChannel = channel
                    CONTROL_CHANNEL -> {
                        controlChannel = channel
                        controlTransport?.bind(channel)
                    }
                    VIEW_CHANNEL -> {
                        viewChannel = channel
                        channel.registerObserver(object : DataChannel.Observer {
                            override fun onBufferedAmountChange(previousAmount: Long) = Unit
                            override fun onStateChange() {
                                if (channel.state() == DataChannel.State.OPEN) sendView()
                            }
                            override fun onMessage(buffer: DataChannel.Buffer) = Unit
                        })
                        sendView()
                    }
                    else -> channel.close()
                }
            }
            override fun onRenegotiationNeeded() = Unit
            override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) {
                val track = receiver.track() as? VideoTrack ?: return
                remoteVideoTrack = track
                renderer?.let(track::addSink)
                PlatformRemoteLogger.info("native WebRTC video track attached")
            }
        })
    }

    /** Adds a step to [trace]; WebRTC calls back from its own threads. */
    private fun note(step: String) {
        val time = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())
        _trace.update { (it + "$time $step").takeLast(TRACE_STEPS) }
    }

    /** Samples WebRTC's statistics once a second while the picture flows. */
    private fun sampleStats() {
        if (statsJob?.isActive == true) return
        statsJob =
            scope.launch {
                var sampleCount = 0
                while (!stopped) {
                    val peer = peerConnection ?: break
                    val entries = CompletableDeferred<List<RemoteStreamStats.Entry>>()
                    peer.getStats { report ->
                        entries.complete(report.statsMap.values.map { RemoteStreamStats.Entry(it.id, it.type, it.members) })
                    }
                    val (next, totals) = RemoteStreamStats.read(entries.await(), lastTotals, remoteNetworkInterfaces())
                    lastTotals = totals
                    _stats.value = next
                    // Correlate with the desktop's five-second stream log and WebRTC's EglRenderer log.
                    if (next.framesDecoded != null && sampleCount++ % 5 == 0) {
                        PlatformRemoteLogger.info("native WebRTC stream", mapOf(
                            "framesPerSecond" to next.framesPerSecond,
                            "width" to next.frameWidth,
                            "height" to next.frameHeight,
                            "decoder" to next.decoder,
                            "framesReceived" to next.framesReceived,
                            "framesDecoded" to next.framesDecoded,
                            "framesDropped" to next.framesDropped,
                            "freezeCount" to next.freezeCount,
                            "decodeMs" to next.decodeMs,
                            "jitterBufferMs" to next.jitterBufferMs,
                            "roundTripMs" to next.roundTripMs,
                        ))
                    }
                    delay(1_000)
                }
            }
    }

    private fun handleSignal(raw: String) {
        for (line in raw.split('\n').filter { it.isNotBlank() }) {
            val signal = json.parseToJsonElement(line).jsonObject
            when (signal["type"]?.jsonPrimitive?.contentOrNull) {
                "offer" -> {
                    val sdp = signal["sdp"]?.jsonPrimitive?.content ?: return
                    note("offer received")
                    PlatformRemoteLogger.info("native WebRTC offer received")
                    peerConnection?.setRemoteDescription(object : SdpObserver by LoggingSdpObserver {
                        override fun onSetSuccess() {
                            PlatformRemoteLogger.info("native WebRTC remote description set")
                            remoteDescriptionSet = true
                            pendingCandidates.forEach { peerConnection?.addIceCandidate(it) }
                            pendingCandidates.clear()
                            peerConnection?.createAnswer(object : SdpObserver by LoggingSdpObserver {
                                override fun onCreateSuccess(description: SessionDescription) {
                                    peerConnection?.setLocalDescription(object : SdpObserver by LoggingSdpObserver {
                                        override fun onSetSuccess() {
                                            PlatformRemoteLogger.info("native WebRTC local description set")
                                            sendSignal(buildJsonObject {
                                                put("type", "answer")
                                                put("protocolVersion", PROTOCOL_VERSION)
                                                put("sessionId", sessionId())
                                                put("sdp", description.description)
                                            })
                                            note("answer sent")
                                            PlatformRemoteLogger.info("native WebRTC answer sent")
                                        }
                                    }, description)
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

    private fun sessionId(): String = Regex("/v2/desktop/([A-Za-z0-9_-]{16,128})/").find(target)?.groupValues?.get(1).orEmpty()

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

    private class NativeRemoteControlTransport(
        private val owner: NativeRemoteDesktopSession,
    ) : RemoteTransport {
        private val incomingChannel = Channel<RemoteFrame>(Channel.UNLIMITED)
        private val ready = CompletableDeferred<DataChannel>()
        private var channel: DataChannel? = null
        private var closed = false

        override val incoming: Flow<RemoteFrame> = incomingChannel.receiveAsFlow()
        override var closeReason: String? = null
            private set

        override suspend fun connect() {
            owner.start()
            ready.await()
        }

        override suspend fun send(frame: RemoteFrame) {
            val active = ready.await()
            check(active.state() == DataChannel.State.OPEN) { "remote control data channel is not open" }
            val bytes = RemoteProtocol.encode(frame).toByteArray(Charsets.UTF_8)
            check(active.send(DataChannel.Buffer(java.nio.ByteBuffer.wrap(bytes), false))) {
                "remote control data channel rejected the frame"
            }
        }

        override suspend fun close() {
            // A stopped session has disposed the channel, and closing it then throws.
            if (!owner.isStopped) channel?.close()
            channelClosed("remote control data channel closed")
            owner.stop()
        }

        fun bind(next: DataChannel) {
            if (channel != null) {
                next.close()
                return
            }
            channel = next
            next.registerObserver(object : DataChannel.Observer {
                override fun onBufferedAmountChange(previousAmount: Long) = Unit

                override fun onStateChange() {
                    when (next.state()) {
                        DataChannel.State.OPEN -> ready.complete(next)
                        DataChannel.State.CLOSING, DataChannel.State.CLOSED -> channelClosed("remote control data channel closed")
                        else -> Unit
                    }
                }

                override fun onMessage(buffer: DataChannel.Buffer) {
                    if (buffer.binary || buffer.data.remaining() > MAX_CONTROL_MESSAGE_BYTES) {
                        next.close()
                        channelClosed("invalid remote control data channel payload")
                        return
                    }
                    val data = ByteArray(buffer.data.remaining())
                    buffer.data.get(data)
                    val frame = runCatching { RemoteProtocol.decode(data.toString(Charsets.UTF_8)) }.getOrElse {
                        next.close()
                        channelClosed("invalid remote control data channel frame")
                        return
                    }
                    incomingChannel.trySend(frame)
                }
            })
            if (next.state() == DataChannel.State.OPEN) ready.complete(next)
        }

        fun channelClosed(reason: String) {
            if (closed) return
            closed = true
            closeReason = reason
            if (!ready.isCompleted) ready.completeExceptionally(IllegalStateException(reason))
            incomingChannel.close()
        }
    }
}

/** One WebRTC session per desktop target, shared by the process link and the Compose renderer. */
object NativeRemoteDesktopSessions {
    private var applicationContext: Context? = null
    private val sessions = mutableMapOf<String, MutableStateFlow<NativeRemoteDesktopSession?>>()

    fun configure(context: Context) {
        applicationContext = context.applicationContext
    }

    fun observe(target: String): StateFlow<NativeRemoteDesktopSession?> = synchronized(this) {
        sessions.getOrPut(target) { MutableStateFlow(null) }
    }

    fun session(target: String): NativeRemoteDesktopSession = synchronized(this) {
        val slot = sessions.getOrPut(target) { MutableStateFlow(null) }
        val current = slot.value
        if (current != null && !current.isStopped) return@synchronized current
        NativeRemoteDesktopSession(requireNotNull(applicationContext) { "native remote desktop sessions are not configured" }, target)
            .also { slot.value = it }
    }

    fun transport(target: String): RemoteTransport = synchronized(this) {
        val slot = sessions.getOrPut(target) { MutableStateFlow(null) }
        val previous = slot.value
        val next = if (previous == null || previous.isStopped) {
            NativeRemoteDesktopSession(requireNotNull(applicationContext) { "native remote desktop sessions are not configured" }, target)
                .also { slot.value = it }
        } else {
            previous
        }
        runCatching { next.createControlTransport() }.getOrElse {
            next.stop()
            NativeRemoteDesktopSession(requireNotNull(applicationContext), target)
                .also { slot.value = it }
                .createControlTransport()
        }
    }
}
