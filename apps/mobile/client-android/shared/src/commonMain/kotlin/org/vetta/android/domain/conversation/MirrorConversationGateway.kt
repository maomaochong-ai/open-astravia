package org.vetta.android.domain.conversation

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import org.vetta.android.core.model.ChatMessage
import org.vetta.android.core.model.ChatQuestion
import org.vetta.android.core.model.ChatQuestionOption
import org.vetta.android.core.model.ChatStreamEvent
import org.vetta.android.core.model.TokenUsage
import org.vetta.android.domain.device.ConnectChannel
import org.vetta.android.domain.device.DesktopDevice
import org.vetta.android.domain.device.DeviceStatus
import org.vetta.android.domain.remote.connection.RemoteRequestException
import org.vetta.android.domain.remote.link.LinkChannel
import org.vetta.android.domain.remote.link.LinkIndicator
import org.vetta.android.domain.remote.link.LinkOfflineException
import org.vetta.android.domain.remote.link.LinkStatus
import org.vetta.android.domain.remote.protocol.RemoteError
import org.vetta.android.domain.remote.protocol.RemoteErrorCode
import org.vetta.android.domain.remote.protocol.RemoteEventName
import org.vetta.android.domain.remote.protocol.RemoteRequestMethod
import org.vetta.android.domain.work.DesktopMirror
import org.vetta.android.domain.work.MirrorState

/**
 * The older desktop chat path, kept working over [DesktopMirror]'s single link
 * until the desktop session screens replace it: the phone keeps one connection
 * per desktop, so this adapter never opens its own.
 */
class MirrorConversationGateway(
    private val mirror: DesktopMirror,
    scope: CoroutineScope,
) : RemoteConversationGateway {
    private val remoteSessionIds = mutableMapOf<String, String>()

    override val devices: StateFlow<List<DesktopDevice>> =
        mirror.state
            .map(::devicesOf)
            .stateIn(scope, SharingStarted.Eagerly, devicesOf(mirror.state.value))

    override suspend fun connect(target: String): Boolean = mirror.pairWithCode(target)

    override suspend fun disconnect(deviceId: String) {
        remoteSessionIds.clear()
        mirror.unpair()
    }

    override fun stream(
        localSessionId: String,
        deviceId: String,
        remoteSessionId: String?,
        messages: List<ChatMessage>,
    ): Flow<ChatStreamEvent> =
        channelFlow {
            val link = mirror.currentLink ?: throw RemoteConversationException("Desktop is not connected")
            if (!link.snapshot.value.isUsable) throw RemoteConversationException("Desktop link is recovering")
            val terminal = CompletableDeferred<ChatStreamEvent.State>()
            var transportStateSent = false

            suspend fun emitTransportState() {
                if (transportStateSent) return
                transportStateSent = true
                send(ChatStreamEvent.State(value = "reconnecting", detail = null, detailCode = "transport_closed"))
            }
            val linkJob =
                launch(start = CoroutineStart.UNDISPATCHED) {
                    // Keeping the turn open while the link recovers would leave the user with an
                    // endless spinner and no way to answer or retry. End the current turn
                    // explicitly; the session can be resumed from history later.
                    link.snapshot.first { it.status != LinkStatus.Online }
                    emitTransportState()
                    terminal.complete(ChatStreamEvent.State(value = "error", detail = null, detailCode = "transport_closed"))
                }
            val eventJob =
                launch(start = CoroutineStart.UNDISPATCHED) {
                    link.events
                        .mapNotNull { event ->
                            val expectedSessionId = remoteSessionId ?: remoteSessionIds[localSessionId]
                            if (expectedSessionId != null && event.sessionId != expectedSessionId) return@mapNotNull null
                            event.sessionId?.let { remoteSessionIds[localSessionId] = it }
                            decodeConversationEvent(event.name, event.payload)
                        }.collect { event ->
                            send(event)
                            if (event is ChatStreamEvent.State && event.value in TERMINAL_REMOTE_STATES) terminal.complete(event)
                        }
                }
            try {
                val payload = buildJsonObject { put("text", messages.lastOrNull()?.textContent.orEmpty()) }
                val result =
                    try {
                        link.request(RemoteRequestMethod.SessionPrompt, payload, remoteSessionId ?: remoteSessionIds[localSessionId])
                    } catch (error: Throwable) {
                        if (
                            error is LinkOfflineException ||
                            (error is RemoteRequestException && error.remoteError.code == RemoteErrorCode.TransportClosed)
                        ) {
                            emitTransportState()
                        }
                        throw error
                    }
                (result as? JsonObject)?.get("sessionId")?.jsonPrimitive?.contentOrNull?.let {
                    remoteSessionIds[localSessionId] = it
                }
                val finalState = terminal.await()
                if (finalState.value == "error") {
                    throw RemoteRequestException(
                        RemoteError(
                            code = finalState.detailCode.toRemoteErrorCode(),
                            message = finalState.detail ?: "Desktop run failed",
                            retryable = finalState.detailCode == "request_timeout" || finalState.detailCode == "busy",
                        ),
                    )
                }
                if (finalState.value != "aborted") send(ChatStreamEvent.Done)
            } finally {
                eventJob.cancel()
                linkJob.cancel()
            }
        }

    override fun resolvedRemoteSessionId(localSessionId: String): String? = remoteSessionIds[localSessionId]

    override suspend fun abort(localSessionId: String, deviceId: String, remoteSessionId: String?) {
        mirror.currentLink?.request(RemoteRequestMethod.SessionAbort, sessionId = remoteSessionId ?: remoteSessionIds[localSessionId])
    }

    override suspend fun respond(
        localSessionId: String,
        deviceId: String,
        remoteSessionId: String?,
        requestId: String,
        answers: List<Pair<String, List<String>>>,
        cancelled: Boolean,
    ) {
        val link = mirror.currentLink ?: throw RemoteConversationException("Desktop is not connected")
        val payload =
            buildJsonObject {
                put("requestId", requestId)
                put("cancelled", cancelled)
                put(
                    "answers",
                    buildJsonArray {
                        answers.forEach { (question, selected) ->
                            add(
                                buildJsonObject {
                                    put("question", question)
                                    put("answers", buildJsonArray { selected.forEach { add(JsonPrimitive(it)) } })
                                },
                            )
                        }
                    },
                )
            }
        link.request(RemoteRequestMethod.SessionRespond, payload, remoteSessionId ?: remoteSessionIds[localSessionId])
    }

    private fun devicesOf(state: MirrorState): List<DesktopDevice> {
        val desktop = state.desktop ?: return emptyList()
        val link = state.link
        return listOf(
            DesktopDevice(
                id = desktop.desktopIdentityKey,
                name = desktop.desktopName,
                osLabel = link.diagnostics?.osLabel ?: link.desktop?.osLabel ?: "Desktop",
                host = desktop.relayBaseUrl?.substringAfter("://")?.substringBefore('/').orEmpty(),
                status =
                    when (LinkIndicator.of(link)) {
                        LinkIndicator.Online -> DeviceStatus.Online
                        LinkIndicator.Connecting, is LinkIndicator.Reconnecting -> DeviceStatus.Connecting
                        LinkIndicator.Offline -> DeviceStatus.Offline
                    },
                channel = if (link.channel == LinkChannel.Lan) ConnectChannel.Lan else ConnectChannel.Remote,
                latencyMs = link.rttMs?.toIntOrNull(),
                onlineSinceEpochMs = link.onlineSince,
                cpu = link.diagnostics?.cpu,
                ram = link.diagnostics?.ram,
                viewerUrl = mirror.viewerUrl(),
            ),
        )
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
            val questions =
                (objectValue["questions"] as? JsonArray).orEmpty().mapNotNull { item ->
                    val question = item as? JsonObject ?: return@mapNotNull null
                    val options =
                        (question["options"] as? JsonArray).orEmpty().mapNotNull { raw ->
                            val option = raw as? JsonObject ?: return@mapNotNull null
                            val label = option.stringValue("label") ?: return@mapNotNull null
                            ChatQuestionOption(label, option.stringValue("description").orEmpty())
                        }
                    ChatQuestion(
                        question.stringValue("question") ?: return@mapNotNull null,
                        question.stringValue("header").orEmpty(),
                        options,
                        question["multiSelect"]?.jsonPrimitive?.booleanOrNull ?: false,
                    )
                }
            ChatStreamEvent.UserInputRequired(requestId, questions)
        }
        RemoteEventName.SessionState -> {
            val state = objectValue.stringValue("state") ?: "unknown"
            ChatStreamEvent.State(
                value = state,
                detail = objectValue.stringValue("message") ?: objectValue.stringValue("text"),
                detailCode = objectValue.stringValue("code"),
                usage =
                    if (state == "usage") {
                        TokenUsage(
                            promptTokens = objectValue.longValue("input")?.toIntOrNull(),
                            completionTokens = objectValue.longValue("output")?.toIntOrNull(),
                            totalTokens = objectValue.longValue("total")?.toIntOrNull(),
                        )
                    } else {
                        null
                    },
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

private fun Long.toIntOrNull(): Int? = takeIf { it in 0..Int.MAX_VALUE.toLong() }?.toInt()
