package org.vetta.android.domain.conversation

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.vetta.android.core.model.ChatMessage
import org.vetta.android.core.model.ChatStreamEvent
import org.vetta.android.domain.device.DesktopDevice

interface RemoteConversationGateway {
    val devices: StateFlow<List<DesktopDevice>>

    suspend fun connect(target: String): Boolean

    suspend fun disconnect(deviceId: String)

    fun stream(
        localSessionId: String,
        deviceId: String,
        remoteSessionId: String?,
        messages: List<ChatMessage>,
    ): Flow<ChatStreamEvent>

    fun resolvedRemoteSessionId(localSessionId: String): String?

    suspend fun abort(localSessionId: String, deviceId: String, remoteSessionId: String?)
}

object UnavailableRemoteConversationGateway : RemoteConversationGateway {
    override val devices: StateFlow<List<DesktopDevice>> = MutableStateFlow(emptyList())

    override suspend fun connect(target: String): Boolean = false

    override suspend fun disconnect(deviceId: String) = Unit

    override fun stream(
        localSessionId: String,
        deviceId: String,
        remoteSessionId: String?,
        messages: List<ChatMessage>,
    ): Flow<ChatStreamEvent> =
        kotlinx.coroutines.flow.flow {
            throw RemoteConversationException("桌面连接已断开，请重新连接后再试")
        }

    override fun resolvedRemoteSessionId(localSessionId: String): String? = null

    override suspend fun abort(localSessionId: String, deviceId: String, remoteSessionId: String?) = Unit
}

class RemoteConversationException(message: String) : IllegalStateException(message)
