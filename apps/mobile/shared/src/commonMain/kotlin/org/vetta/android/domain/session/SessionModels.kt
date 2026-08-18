package org.vetta.android.domain.session

import org.vetta.android.core.model.ChatContentPart
import org.vetta.android.core.model.ChatMessage
import org.vetta.android.core.model.ChatRole

enum class MessageStatus {
    Pending,
    Streaming,
    Complete,
    Error,
    Aborted,
}

data class ChatSession(
    val id: String,
    val title: String,
    val modelId: String?,
    val modelName: String?,
    val createdAtEpochMs: Long,
    val updatedAtEpochMs: Long,
    val pinned: Boolean = false,
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

expect fun nowEpochMs(): Long
