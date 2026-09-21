package org.vetta.android.domain.conversation

import kotlinx.coroutines.flow.Flow
import org.vetta.android.core.model.ChatMessage
import org.vetta.android.core.model.ChatStreamEvent
import org.vetta.android.domain.session.ChatSession
import org.vetta.android.domain.session.ConversationOrigin

class ConversationRouter(
    private val cloudStream: (modelId: String, messages: List<ChatMessage>) -> Flow<ChatStreamEvent>,
    private val remoteGateway: RemoteConversationGateway,
) {
    fun stream(
        session: ChatSession,
        selectedModelId: String?,
        messages: List<ChatMessage>,
    ): Flow<ChatStreamEvent> =
        when (session.origin) {
            ConversationOrigin.Cloud -> {
                val modelId = selectedModelId ?: session.modelId
                    ?: throw RemoteConversationException("当前没有可用的云端模型")
                cloudStream(modelId, messages)
            }
            ConversationOrigin.Desktop -> {
                val deviceId = session.remoteDeviceId
                    ?: throw RemoteConversationException("此会话缺少桌面设备信息，请重新创建")
                remoteGateway.stream(session.id, deviceId, session.remoteSessionId, messages)
            }
        }

    suspend fun abort(session: ChatSession) {
        if (session.origin != ConversationOrigin.Desktop) return
        val deviceId = session.remoteDeviceId ?: return
        remoteGateway.abort(session.id, deviceId, session.remoteSessionId)
    }

    fun resolvedRemoteSessionId(localSessionId: String): String? =
        remoteGateway.resolvedRemoteSessionId(localSessionId)
}
