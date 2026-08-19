package org.vetta.android.domain.conversation

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.vetta.android.core.model.ChatMessage
import org.vetta.android.core.model.ChatStreamEvent
import org.vetta.android.domain.device.ConnectChannel
import org.vetta.android.domain.device.DesktopDevice
import org.vetta.android.domain.device.DeviceStatus
import org.vetta.android.domain.remote.connection.KtorWebSocketRemoteTransport
import org.vetta.android.domain.remote.connection.PlatformRemoteLogger
import org.vetta.android.domain.remote.connection.RemoteConnection
import org.vetta.android.domain.remote.connection.RemoteConnectionEvent
import org.vetta.android.domain.remote.connection.RemoteConnectionOptions
import org.vetta.android.domain.remote.connection.RemoteConnectionState
import org.vetta.android.domain.remote.protocol.RemoteCapabilities
import org.vetta.android.domain.remote.protocol.RemoteRole
import org.vetta.android.domain.remote.protocol.RemoteEventName

class RelayRemoteConversationGateway(
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
    private val transportFactory: (url: String) -> org.vetta.android.domain.remote.connection.RemoteTransport = { url ->
        KtorWebSocketRemoteTransport(url, scope)
    },
) : RemoteConversationGateway {
    private val _devices = MutableStateFlow<List<DesktopDevice>>(emptyList())
    private var connection: RemoteConnection? = null
    private val remoteSessionIds = mutableMapOf<String, String>()

    override val devices: StateFlow<List<DesktopDevice>> = _devices

    override suspend fun connect(target: String): Boolean {
        val url = normalizeRelayUrl(target)
        val old = connection
        old?.close()
        val next =
            RemoteConnection(
                transport = transportFactory(url),
                options =
                    RemoteConnectionOptions(
                        role = RemoteRole.Mobile,
                        deviceId = "mobile-${target.hashCode().toUInt().toString(16)}",
                        deviceName = "Vetta Mobile",
                        capabilities = RemoteCapabilities(chat = true, sessionRead = true),
                        connectionId = "mobile-${kotlin.random.Random.nextLong().toULong().toString(16)}",
                    ),
                scope = scope,
                logger = PlatformRemoteLogger,
                now = { kotlin.time.Clock.System.now().toEpochMilliseconds() },
            )
        connection = next
        next.connect()
        waitUntilOnline(next)
        val snapshot = next.snapshot()
        _devices.value =
            listOf(
                DesktopDevice(
                    id = snapshot.peerDeviceId ?: "desktop",
                    name = snapshot.peerDeviceId ?: "Desktop",
                    osLabel = "Remote relay",
                    host = url,
                    status = DeviceStatus.Online,
                    channel = ConnectChannel.Remote,
                ),
            )
        return true
    }

    override suspend fun disconnect(deviceId: String) {
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
            val eventJob =
                launch(start = CoroutineStart.UNDISPATCHED) {
                    active.events
                        .filterIsInstance<RemoteConnectionEvent.EventReceived>()
                        .mapNotNull { event ->
                            val expectedSessionId = remoteSessionId ?: remoteSessionIds[localSessionId]
                            if (expectedSessionId != null && event.event.sessionId != expectedSessionId) return@mapNotNull null
                            event.event.sessionId?.let { remoteSessionIds[localSessionId] = it }
                            if (event.event.name != RemoteEventName.SessionMessage) return@mapNotNull null
                            val payload = event.event.payload?.jsonObject ?: return@mapNotNull null
                            payload["text"]?.jsonPrimitive?.content
                        }.collect { send(ChatStreamEvent.Delta(it)) }
                }
            try {
                val payload = buildJsonObject { put("text", messages.lastOrNull()?.textContent.orEmpty()) }
                val result = active.request(
                    method = org.vetta.android.domain.remote.protocol.RemoteRequestMethod.SessionPrompt,
                    payload = payload,
                    sessionId = remoteSessionId ?: remoteSessionIds[localSessionId],
                )
                result?.jsonObject?.get("sessionId")?.jsonPrimitive?.content?.let {
                    remoteSessionIds[localSessionId] = it
                }
                send(ChatStreamEvent.Done)
            } finally {
                eventJob.cancel()
            }
        }

    override fun resolvedRemoteSessionId(localSessionId: String): String? = remoteSessionIds[localSessionId]

    override suspend fun abort(localSessionId: String, deviceId: String, remoteSessionId: String?) {
        connection?.request(
            method = org.vetta.android.domain.remote.protocol.RemoteRequestMethod.SessionAbort,
            sessionId = remoteSessionId ?: remoteSessionIds[localSessionId],
        )
    }

    private suspend fun waitUntilOnline(connection: RemoteConnection) {
        kotlinx.coroutines.withTimeout(10_000) { connection.state.first { it == RemoteConnectionState.Online } }
    }

    private fun normalizeRelayUrl(target: String): String {
        val value = target.trim()
        if (value.startsWith("ws://") || value.startsWith("wss://")) return value
        val separator = value.indexOf('#')
        val host = if (separator >= 0) value.substring(0, separator) else value
        val pairing = if (separator >= 0) value.substring(separator + 1) else "default"
        return "ws://$host/relay/$pairing/mobile"
    }
}
