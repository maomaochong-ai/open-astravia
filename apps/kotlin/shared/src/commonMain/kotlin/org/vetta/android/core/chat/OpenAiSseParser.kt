package org.vetta.android.core.chat

import org.vetta.android.core.api.ChatCompletionChunkDto
import org.vetta.android.core.api.toDomain
import org.vetta.android.core.error.VettaException
import org.vetta.android.core.model.ChatStreamEvent
import org.vetta.android.core.net.VettaJson

/**
 * 解析 OpenAI 兼容 SSE 单行（`data: {...}` / `data: [DONE]`）。
 * 非 data 行（event:/id:/空行/注释）返回 null。
 */
object OpenAiSseParser {
    fun parseLine(line: String): ChatStreamEvent? {
        val trimmed = line.trim()
        if (trimmed.isEmpty() || trimmed.startsWith(":")) return null
        if (!trimmed.startsWith("data:")) return null

        val data = trimmed.removePrefix("data:").trim()
        if (data.isEmpty()) return null
        if (data == "[DONE]") return ChatStreamEvent.Done

        val chunk =
            runCatching {
                VettaJson.decodeFromString(ChatCompletionChunkDto.serializer(), data)
            }.getOrElse { cause ->
                return ChatStreamEvent.Error(
                    VettaException.Protocol("无法解析 SSE chunk", cause),
                )
            }

        val choice = chunk.choices.firstOrNull()
        val deltaText = choice?.delta?.content
        if (!deltaText.isNullOrEmpty()) {
            return ChatStreamEvent.Delta(deltaText)
        }

        val finishReason = choice?.finishReason
        if (finishReason != null || chunk.usage != null) {
            return ChatStreamEvent.Finished(
                finishReason = finishReason,
                usage = chunk.usage?.toDomain(),
            )
        }

        return null
    }
}
