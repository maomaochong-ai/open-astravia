package org.vetta.android.domain.session

import org.vetta.android.core.model.ChatContentPart
import org.vetta.android.core.model.ChatMessage
import org.vetta.android.core.model.ChatRole
import org.vetta.android.core.model.ChatQuestion
import org.vetta.android.core.model.TokenUsage

enum class MessageStatus {
    Pending,
    Streaming,
    Complete,
    Error,
    Aborted,
}

enum class ConversationOrigin {
    Cloud,
    Desktop,
}

data class ChatSession(
    val id: String,
    val title: String,
    val modelId: String?,
    val modelName: String?,
    val createdAtEpochMs: Long,
    val updatedAtEpochMs: Long,
    val pinned: Boolean = false,
    val origin: ConversationOrigin = ConversationOrigin.Cloud,
    val remoteDeviceId: String? = null,
    val remoteSessionId: String? = null,
)

data class MessageImage(
    val id: String,
    val mimeType: String,
    val fileName: String? = null,
    val base64Data: String,
) {
    fun toContentPart(): ChatContentPart.Image =
        ChatContentPart.Image(mimeType = mimeType, base64Data = base64Data)
}

data class LocalMessage(
    val id: String,
    val sessionId: String,
    val role: ChatRole,
    val content: String,
    val status: MessageStatus,
    val createdAtEpochMs: Long,
    val errorMessage: String? = null,
    val images: List<MessageImage> = emptyList(),
    val toolEvents: List<ToolTrace> = emptyList(),
    val usage: TokenUsage? = null,
    val contextPercent: Int? = null,
    /** 待用户回答的问题属于这条 assistant 消息，持久化后可在切换/重启后继续处理。 */
    val pendingQuestion: PendingQuestion? = null,
) {
    fun toChatMessage(): ChatMessage {
        val parts = mutableListOf<ChatContentPart>()
        if (content.isNotEmpty()) {
            parts.add(ChatContentPart.Text(content))
        }
        images.forEach { parts.add(it.toContentPart()) }
        if (parts.isEmpty()) {
            parts.add(ChatContentPart.Text(""))
        }
        return ChatMessage(role = role, parts = parts)
    }

    val hasVisualContent: Boolean
        get() = content.isNotBlank() || images.isNotEmpty()
}

data class ToolTrace(
    val phase: String,
    val toolCallId: String,
    val toolName: String,
    val detail: String? = null,
    val durationMs: Long? = null,
    val arguments: String? = null,
    val result: String? = null,
    val phaseLabel: String? = null,
)

data class PendingQuestion(
    val sessionId: String = "",
    val requestId: String,
    val questions: List<ChatQuestion>,
    val selections: Map<String, List<String>> = emptyMap(),
)

expect fun nowEpochMs(): Long
