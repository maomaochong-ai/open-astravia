package org.vetta.android.core.model

enum class ChatRole {
    System,
    User,
    Assistant,
    ;

    fun toApiValue(): String =
        when (this) {
            System -> "system"
            User -> "user"
            Assistant -> "assistant"
        }

    companion object {
        fun fromApi(value: String): ChatRole =
            when (value.lowercase()) {
                "system" -> System
                "assistant" -> Assistant
                else -> User
            }
    }
}

/**
 * 发给 Gateway 的消息。文本与图片统一为 [parts]，由 [org.vetta.android.core.chat.ChatRequestEncoder]
 * 编码为 OpenAI 兼容 wire 形态。
 */
data class ChatMessage(
    val role: ChatRole,
    val parts: List<ChatContentPart>,
) {
    constructor(role: ChatRole, content: String) : this(
        role = role,
        parts = if (content.isEmpty()) emptyList() else listOf(ChatContentPart.Text(content)),
    )

    val textContent: String
        get() =
            parts
                .filterIsInstance<ChatContentPart.Text>()
                .joinToString("") { it.text }
}

sealed class ChatContentPart {
    data class Text(val text: String) : ChatContentPart()

    data class Image(
        val mimeType: String,
        val base64Data: String,
    ) : ChatContentPart() {
        val dataUrl: String
            get() = "data:$mimeType;base64,$base64Data"
    }
}

/**
 * Gateway 流式事件。UI 层按序消费即可拼出 assistant 气泡。
 */
sealed class ChatStreamEvent {
    data class Delta(val text: String) : ChatStreamEvent()

    data class Finished(
        val finishReason: String?,
        val usage: TokenUsage? = null,
    ) : ChatStreamEvent()

    data object Done : ChatStreamEvent()

    data class Error(val exception: Throwable) : ChatStreamEvent()
}

data class TokenUsage(
    val promptTokens: Int? = null,
    val completionTokens: Int? = null,
    val totalTokens: Int? = null,
)
