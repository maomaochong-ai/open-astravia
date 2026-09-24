package org.vetta.android.domain.conversation

import kotlinx.coroutines.flow.Flow
import org.vetta.android.core.model.ChatMessage
import org.vetta.android.core.model.ChatStreamEvent
import org.vetta.android.domain.session.ChatSession

/**
 * Streams a cloud conversation's reply. Desktop conversations do not come
 * through here: they run on the desktop's own session page.
 */
class ConversationRouter(
    private val cloudStream: (modelId: String, messages: List<ChatMessage>) -> Flow<ChatStreamEvent>,
) {
    fun stream(
        session: ChatSession,
        selectedModelId: String?,
        messages: List<ChatMessage>,
    ): Flow<ChatStreamEvent> {
        val modelId = checkNotNull(selectedModelId ?: session.modelId) { "No cloud model available" }
        return cloudStream(modelId, messages)
    }
}
