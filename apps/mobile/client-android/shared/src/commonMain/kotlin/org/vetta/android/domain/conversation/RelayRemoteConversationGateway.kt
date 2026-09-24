package org.vetta.android.domain.conversation

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.cancelAndJoin
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.vetta.android.core.model.ChatMessage
import org.vetta.android.core.model.ChatQuestion
import org.vetta.android.core.model.ChatQuestionOption
import org.vetta.android.core.model.ChatStreamEvent
import org.vetta.android.core.model.TokenUsage
import org.vetta.android.domain.device.ConnectChannel
import org.vetta.android.domain.device.DesktopDevice
import org.vetta.android.domain.device.DeviceStatus
import org.vetta.android.domain.remote.connection.KtorWebSocketRemoteTransport
import org.vetta.android.domain.remote.connection.PlatformRemoteLogger
import org.vetta.android.domain.remote.connection.RemoteConnection
import org.vetta.android.domain.remote.connection.RemoteConnectionEvent
import org.vetta.android.domain.remote.connection.RemoteConnectionOptions
import org.vetta.android.domain.remote.connection.RemoteConnectionState
import org.vetta.android.domain.remote.connection.RemoteRequestException
import org.vetta.android.domain.remote.parseMobileConnectionTarget
import org.vetta.android.domain.remote.protocol.RemoteCrypto
import org.vetta.android.domain.remote.protocol.RemoteCapabilities
import org.vetta.android.domain.remote.protocol.RemoteRole
import org.vetta.android.domain.remote.protocol.RemoteEventName
import org.vetta.android.domain.remote.protocol.RemoteError
import org.vetta.android.domain.remote.protocol.RemoteErrorCode
import org.vetta.android.domain.remote.protocol.RemoteRequestMethod

class RelayRemoteConversationGateway(
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
    private val transportFactory: (url: String, pairingSecret: String) -> org.vetta.android.domain.remote.connection.RemoteTransport = { url, pairingSecret ->
        KtorWebSocketRemoteTransport(url, pairingSecret, scope)
    },
    private val now: () -> Long = { kotlin.time.Clock.System.now().toEpochMilliseconds() },
) : RemoteConversationGateway {
    private val _devices = MutableStateFlow<List<DesktopDevice>>(emptyList())
    private var connection: RemoteConnection? = null
    private var connectionStateJob: Job? = null
    private var reconnectJob: Job? = null
    private var metricsJob: Job? = null
    private var connectionTarget: String? = null
    private var connectedAtEpochMs: Long = 0L
    private var latestDiagnostics: DeviceDiagnostics? = null
    private val remoteSessionIds = mutableMapOf<String, String>()

    override val devices: StateFlow<List<DesktopDevice>> = _devices

    override suspend fun connect(target: String): Boolean {
        val parsedTarget = parseMobileConnectionTarget(target) ?: return false
        reconnectJob?.cancelAndJoin()
        reconnectJob = null
        connectionTarget = target
        val old = connection
        connectionStateJob?.cancel()
        connectionStateJob = null
        metricsJob?.cancel()
        metricsJob = null
        old?.close()
        val next = createConnection(target, parsedTarget)
        connection = next
        observeConnection(next)
        next.connect()
        waitUntilOnline(next)
        val snapshot = next.snapshot()
        connectedAtEpochMs = now()
        val diagnostics = requestDiagnostics(next)
        latestDiagnostics = diagnostics
        _devices.value =
            listOf(
                DesktopDevice(
                    id = snapshot.peerDeviceId ?: "desktop",
                    name = snapshot.peerDeviceId ?: "Desktop",
                    osLabel = diagnostics?.osLabel ?: "Desktop",
                    host = target,
                    status = DeviceStatus.Online,
                    channel = ConnectChannel.Remote,
                    latencyMs = next.snapshot().lastRttMs?.toIntOrNull(),
                    connectedDuration = formatConnectionDuration(now() - connectedAtEpochMs),
                    cpu = diagnostics?.cpu,
                    ram = diagnostics?.ram,
                ),
            )
        startMetrics(next)
        return true
    }

    private fun createConnection(
        target: String,
        parsedTarget: org.vetta.android.domain.remote.MobileConnectionTarget,
    ): RemoteConnection =
        RemoteConnection(
            transport = transportFactory(parsedTarget.url, parsedTarget.pairingSecret),
            options =
                RemoteConnectionOptions(
                    role = RemoteRole.Mobile,
                    deviceId = "mobile-${target.hashCode().toUInt().toString(16)}",
                    deviceName = "Vetta Mobile",
                    capabilities = RemoteCapabilities(chat = true, sessionRead = true),
                    identity =
                        RemoteCrypto.identityKeyPairFromSecret(
                            RemoteCrypto.fromBase64Url(parsedTarget.identitySecret),
                        ),
                    expectedPeerIdentityKey = RemoteCrypto.decodePublicKey(parsedTarget.desktopIdentityKey),
                    connectionId = "mobile-${kotlin.random.Random.nextLong().toULong().toString(16)}",
                ),
            scope = scope,
            logger = PlatformRemoteLogger,
            now = now,
        )

    private fun observeConnection(next: RemoteConnection) {
        connectionStateJob?.cancel()
        connectionStateJob = scope.launch {
            next.state.collect { state ->
                val status =
                    when (state) {
                        RemoteConnectionState.Online -> DeviceStatus.Online
                        RemoteConnectionState.Connecting,
                        RemoteConnectionState.PendingApproval,
                        RemoteConnectionState.Reconnecting,
                        RemoteConnectionState.Recovering,
                        -> DeviceStatus.Connecting
                        RemoteConnectionState.Idle -> DeviceStatus.Connecting
                        RemoteConnectionState.Closed,
                        RemoteConnectionState.Failed,
                        -> DeviceStatus.Offline
                    }
                _devices.updateStatus(status)
                if (state == RemoteConnectionState.Reconnecting) scheduleReconnect(next)
            }
        }
    }

    private fun scheduleReconnect(source: RemoteConnection) {
        if (reconnectJob?.isActive == true || connectionTarget == null) return
        reconnectJob = scope.launch {
            var backoffMs = INITIAL_RECONNECT_DELAY_MS
            while (isActive && connection === source) {
                delay(backoffMs)
                if (!isActive || connection !== source) return@launch
                val target = connectionTarget ?: return@launch
                val parsedTarget = parseMobileConnectionTarget(target) ?: return@launch
                val replacement = createConnection(target, parsedTarget)
                connection = replacement
                observeConnection(replacement)
                try {
                    replacement.connect()
                    waitUntilOnline(replacement)
                    source.close()
                    val diagnostics = requestDiagnostics(replacement) ?: latestDiagnostics
                    latestDiagnostics = diagnostics
                    _devices.update { devices ->
                        devices.map { device ->
                            val snapshot = replacement.snapshot()
                            device.copy(
                                id = snapshot.peerDeviceId ?: device.id,
                                name = snapshot.peerDeviceId ?: device.name,
                                status = DeviceStatus.Online,
                                osLabel = diagnostics?.osLabel ?: device.osLabel,
                                cpu = diagnostics?.cpu ?: device.cpu,
                                ram = diagnostics?.ram ?: device.ram,
                            )
                        }
                    }
                    startMetrics(replacement)
                    return@launch
                } catch (_: Throwable) {
                    replacement.close()
                    if (connection === replacement) connection = source
                    observeConnection(source)
                    backoffMs = (backoffMs * 2).coerceAtMost(MAX_RECONNECT_DELAY_MS)
                }
            }
        }
    }

    private fun startMetrics(next: RemoteConnection) {
        metricsJob?.cancel()
        metricsJob = scope.launch {
            var nextDiagnosticsAt = now() + METRICS_DIAGNOSTICS_INTERVAL_MS
            while (isActive && connection === next) {
                if (next.state.value == RemoteConnectionState.Online && now() >= nextDiagnosticsAt) {
                    requestDiagnostics(next)?.let { latestDiagnostics = it }
                    nextDiagnosticsAt = now() + METRICS_DIAGNOSTICS_INTERVAL_MS
                }
                val latest = next.snapshot()
                _devices.updateMetrics(
                    connectedDuration = formatConnectionDuration(now() - connectedAtEpochMs),
                    latencyMs = latest.lastRttMs?.toIntOrNull(),
                    diagnostics = latestDiagnostics,
                )
                delay(METRICS_REFRESH_INTERVAL_MS)
            }
        }
    }

    override suspend fun disconnect(deviceId: String) {
        reconnectJob?.cancelAndJoin()
        reconnectJob = null
        connectionTarget = null
        connectionStateJob?.cancel()
        connectionStateJob = null
        metricsJob?.cancel()
        metricsJob = null
        connection?.close()
        connection = null
        remoteSessionIds.clear()
        _devices.value = emptyList()
    }

    override fun stream(
        localSessionId: String,
        deviceId: String,
        remoteSessionId: String?,
        messages: List<ChatMessage>,
    ): Flow<ChatStreamEvent> =
        channelFlow {
            val active = connection ?: throw RemoteConversationException("请先连接桌面设备")
            if (active.state.value != RemoteConnectionState.Online) {
                throw RemoteConversationException("桌面连接正在恢复，请稍后重试")
            }
            val terminal = CompletableDeferred<ChatStreamEvent.State>()
            var transportStateSent = false
            suspend fun emitTransportState() {
                if (transportStateSent) return
                transportStateSent = true
                send(
                    ChatStreamEvent.State(
                        value = "reconnecting",
                        detail = "桌面连接正在恢复",
                        detailCode = "transport_closed",
                    ),
                )
            }
            val connectionJob = launch(start = CoroutineStart.UNDISPATCHED) {
                // RemoteConnection does not own a reconnect loop. Once the transport
                // enters recovery, keeping the turn open would leave the user with an
                // endless spinner and no way to answer or retry. End the current turn
                // explicitly; a later connection can resume the session from history.
                active.state.first {
                    it == RemoteConnectionState.Reconnecting ||
                        it == RemoteConnectionState.Closed ||
                        it == RemoteConnectionState.Failed
                }
                emitTransportState()
                terminal.complete(
                    ChatStreamEvent.State(
                        value = "error",
                        detail = "桌面连接已断开，请重新连接后再试",
                        detailCode = "transport_closed",
                    ),
                )
            }
            val eventJob = launch(start = CoroutineStart.UNDISPATCHED) {
					active.events
						.filterIsInstance<RemoteConnectionEvent.EventReceived>()
						.mapNotNull { event ->
                            val expectedSessionId = remoteSessionId ?: remoteSessionIds[localSessionId]
                            if (expectedSessionId != null && event.event.sessionId != expectedSessionId) return@mapNotNull null
                            event.event.sessionId?.let { remoteSessionIds[localSessionId] = it }
							decodeConversationEvent(event.event.name, event.event.payload)
						}.collect { event ->
                            send(event)
                            if (event is ChatStreamEvent.State && event.value in TERMINAL_REMOTE_STATES) terminal.complete(event)
                        }
		}

            try {
                val payload = buildJsonObject { put("text", messages.lastOrNull()?.textContent.orEmpty()) }
                val result = try {
                    active.request(
                        method = org.vetta.android.domain.remote.protocol.RemoteRequestMethod.SessionPrompt,
                        payload = payload,
                        sessionId = remoteSessionId ?: remoteSessionIds[localSessionId],
                    )
                } catch (error: Throwable) {
                    if (
                        active.state.value == RemoteConnectionState.Reconnecting ||
                            active.state.value == RemoteConnectionState.Closed ||
                            (error is RemoteRequestException && error.remoteError.code == RemoteErrorCode.TransportClosed)
                    ) {
                        emitTransportState()
                    }
                    throw error
                }
                result?.jsonObject?.get("sessionId")?.jsonPrimitive?.content?.let {
                    remoteSessionIds[localSessionId] = it
                }
                _devices.updateLatency(active.snapshot().lastRttMs?.toIntOrNull())
                val finalState = terminal.await()
                if (finalState.value == "error") {
                    throw RemoteRequestException(
                        RemoteError(
                            code = finalState.detailCode.toRemoteErrorCode(),
                            message = finalState.detail ?: "桌面执行失败",
                            retryable = finalState.detailCode == "request_timeout" || finalState.detailCode == "busy",
                        ),
                    )
                }
                if (finalState.value != "aborted") send(ChatStreamEvent.Done)
            } finally {
                eventJob.cancel()
                connectionJob.cancel()
            }
        }

    override fun resolvedRemoteSessionId(localSessionId: String): String? = remoteSessionIds[localSessionId]

    override suspend fun abort(localSessionId: String, deviceId: String, remoteSessionId: String?) {
        connection?.request(
            method = org.vetta.android.domain.remote.protocol.RemoteRequestMethod.SessionAbort,
            sessionId = remoteSessionId ?: remoteSessionIds[localSessionId],
        )
    }

    override suspend fun respond(
        localSessionId: String,
        deviceId: String,
        remoteSessionId: String?,
        requestId: String,
        answers: List<Pair<String, List<String>>>,
        cancelled: Boolean,
    ) {
        val active = connection ?: throw RemoteConversationException("请先连接桌面设备")
        val payload = buildJsonObject {
            put("requestId", requestId)
            put("cancelled", cancelled)
            put("answers", kotlinx.serialization.json.buildJsonArray {
                answers.forEach { (question, selected) ->
                    add(buildJsonObject {
                        put("question", question)
                        put("answers", kotlinx.serialization.json.buildJsonArray { selected.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } })
                    })
                }
            })
        }
        active.request(
            method = RemoteRequestMethod.SessionRespond,
            payload = payload,
            sessionId = remoteSessionId ?: remoteSessionIds[localSessionId],
        )
    }

    private suspend fun waitUntilOnline(connection: RemoteConnection) {
        kotlinx.coroutines.withTimeout(RECONNECT_CONNECT_TIMEOUT_MS) {
            connection.state.first {
                it == RemoteConnectionState.Online ||
                    it == RemoteConnectionState.Failed ||
                    it == RemoteConnectionState.Closed
            }
        }
        check(connection.state.value == RemoteConnectionState.Online) {
            "桌面连接未完成握手：${connection.state.value.name.lowercase()}"
        }
    }

    private suspend fun requestDiagnostics(connection: RemoteConnection): DeviceDiagnostics? {
        return try {
            connection
                .request(method = org.vetta.android.domain.remote.protocol.RemoteRequestMethod.DiagnosticsSnapshot)
                .toDeviceDiagnostics()
        } catch (error: Throwable) {
            if (error is CancellationException) throw error
            null
        }
    }

    private fun MutableStateFlow<List<DesktopDevice>>.updateStatus(status: DeviceStatus) {
        update { devices -> devices.map { device -> device.copy(status = status) } }
    }

    private fun MutableStateFlow<List<DesktopDevice>>.updateLatency(latencyMs: Int?) {
        if (latencyMs == null) return
        update { devices -> devices.map { device -> device.copy(latencyMs = latencyMs) } }
    }

    private fun MutableStateFlow<List<DesktopDevice>>.updateMetrics(
        connectedDuration: String,
        latencyMs: Int?,
        diagnostics: DeviceDiagnostics?,
    ) {
        update { devices ->
            devices.map { device ->
                device.copy(
                    connectedDuration = connectedDuration,
                    latencyMs = latencyMs ?: device.latencyMs,
                    osLabel = diagnostics?.osLabel ?: device.osLabel,
                    cpu = diagnostics?.cpu ?: device.cpu,
                    ram = diagnostics?.ram ?: device.ram,
                )
            }
        }
    }
}

private fun decodeConversationEvent(name: RemoteEventName, payload: JsonElement?): ChatStreamEvent? {
	val objectValue = payload as? JsonObject ?: return null
	return when (name) {
		RemoteEventName.SessionMessage -> objectValue.stringValue("text")?.let(ChatStreamEvent::Delta)
		RemoteEventName.SessionTool -> {
			val phase = objectValue.stringValue("phase") ?: return null
			val callId = objectValue.stringValue("toolCallId") ?: return null
			val toolName = objectValue.stringValue("toolName") ?: "tool"
			val arguments = objectValue.stringValue("args")
			val result = objectValue.stringValue("result")
            ChatStreamEvent.Tool(
                phase = phase,
                toolCallId = callId,
                toolName = toolName,
                detail = result ?: arguments,
                durationMs = objectValue.longValue("durationMs"),
                arguments = arguments,
                result = result,
                phaseLabel = objectValue.stringValue("label"),
            )
		}
		RemoteEventName.SessionInput -> {
			if (objectValue.stringValue("kind") != "question") return null
			val requestId = objectValue.stringValue("requestId") ?: return null
			val questions = (objectValue["questions"] as? JsonArray).orEmpty().mapNotNull { item ->
				val question = item as? JsonObject ?: return@mapNotNull null
				val options = (question["options"] as? JsonArray).orEmpty().mapNotNull { raw ->
					val option = raw as? JsonObject ?: return@mapNotNull null
					val label = option.stringValue("label") ?: return@mapNotNull null
					ChatQuestionOption(label, option.stringValue("description").orEmpty())
				}
				ChatQuestion(question.stringValue("question") ?: return@mapNotNull null, question.stringValue("header").orEmpty(), options, question["multiSelect"]?.jsonPrimitive?.booleanOrNull ?: false)
			}
			ChatStreamEvent.UserInputRequired(requestId, questions)
		}
        RemoteEventName.SessionState -> {
            val state = objectValue.stringValue("state") ?: "unknown"
            ChatStreamEvent.State(
                value = state,
                detail = objectValue.stringValue("message") ?: objectValue.stringValue("text"),
                detailCode = objectValue.stringValue("code"),
                usage = if (state == "usage") {
                    TokenUsage(
                        promptTokens = objectValue.longValue("input")?.toIntOrNull(),
                        completionTokens = objectValue.longValue("output")?.toIntOrNull(),
                        totalTokens = objectValue.longValue("total")?.toIntOrNull(),
                    )
                } else null,
                contextPercent = objectValue.longValue("contextPercent")?.toIntOrNull(),
            )
        }
		else -> null
	}
}

private fun JsonObject.stringValue(key: String): String? = get(key)?.jsonPrimitive?.contentOrNull
private fun JsonObject.longValue(key: String): Long? = get(key)?.jsonPrimitive?.longOrNull

private val TERMINAL_REMOTE_STATES = setOf("completed", "error", "aborted")

private fun String?.toRemoteErrorCode(): RemoteErrorCode =
    when (this) {
        "unauthorized" -> RemoteErrorCode.Unauthorized
        "not_found" -> RemoteErrorCode.NotFound
        "busy" -> RemoteErrorCode.Busy
        "request_timeout" -> RemoteErrorCode.RequestTimeout
        "transport_closed" -> RemoteErrorCode.TransportClosed
        "invalid_frame" -> RemoteErrorCode.InvalidFrame
        "unsupported_version" -> RemoteErrorCode.UnsupportedVersion
        else -> RemoteErrorCode.InternalError
    }

private const val METRICS_REFRESH_INTERVAL_MS = 1_000L
private const val METRICS_DIAGNOSTICS_INTERVAL_MS = 5_000L
private const val INITIAL_RECONNECT_DELAY_MS = 250L
private const val MAX_RECONNECT_DELAY_MS = 10_000L
private const val RECONNECT_CONNECT_TIMEOUT_MS = 10_000L

private data class DeviceDiagnostics(
    val osLabel: String?,
    val cpu: String?,
    val ram: String?,
)

private fun JsonElement?.toDeviceDiagnostics(): DeviceDiagnostics? {
    val objectValue = this as? JsonObject ?: return null
    return DeviceDiagnostics(
        osLabel = objectValue.stringValue("osLabel"),
        cpu = objectValue.stringValue("cpu"),
        ram = objectValue.stringValue("ram"),
    )
}

private fun Long.toIntOrNull(): Int? = takeIf { it in 0..Int.MAX_VALUE.toLong() }?.toInt()

private fun formatConnectionDuration(elapsedMs: Long): String {
    val totalSeconds = (elapsedMs.coerceAtLeast(0) / 1_000).coerceAtLeast(1)
    val hours = totalSeconds / 3_600
    val minutes = (totalSeconds % 3_600) / 60
    val seconds = totalSeconds % 60
    return when {
        hours > 0 -> "${hours}时${minutes}分"
        minutes > 0 -> "${minutes}分${seconds}秒"
        else -> "${seconds}秒"
    }
}
