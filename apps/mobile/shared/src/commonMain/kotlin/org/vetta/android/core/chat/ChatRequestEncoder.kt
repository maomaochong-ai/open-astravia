package org.vetta.android.core.chat

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.vetta.android.core.model.ChatContentPart
import org.vetta.android.core.model.ChatMessage

/**
 * 将领域 [ChatMessage] 编码为 OpenAI Chat Completions 兼容的 messages 数组元素。
 * 纯函数，供 UI 发送路径与单元测试共用。
 */
object ChatRequestEncoder {
    fun encodeMessages(messages: List<ChatMessage>): List<JsonObject> =
        messages.map { encodeMessage(it) }

    fun encodeMessage(message: ChatMessage): JsonObject =
        buildJsonObject {
            put("role", message.role.toApiValue())
            put("content", encodeContent(message.parts))
        }

    fun encodeContent(parts: List<ChatContentPart>): JsonElement {
        val images = parts.filterIsInstance<ChatContentPart.Image>()
        val texts = parts.filterIsInstance<ChatContentPart.Text>()
        if (images.isEmpty()) {
            return JsonPrimitive(texts.joinToString("") { it.text })
        }
        return buildJsonArray {
            texts.forEach { text ->
                if (text.text.isNotEmpty()) {
                    add(
                        buildJsonObject {
                            put("type", "text")
                            put("text", text.text)
                        },
                    )
                }
            }
            images.forEach { image ->
                add(
                    buildJsonObject {
                        put("type", "image_url")
                        put(
                            "image_url",
                            buildJsonObject {
                                put("url", image.dataUrl)
                            },
                        )
                    },
                )
            }
            // 纯图且无文本时仍给出空 text，部分上游更稳
            if (texts.isEmpty()) {
                // already only images — fine
            }
        }
    }

    fun contentHasImageParts(content: JsonElement): Boolean {
        val arr = content as? JsonArray ?: return false
        return arr.any { el ->
            val obj = el as? JsonObject ?: return@any false
            (obj["type"] as? JsonPrimitive)?.content == "image_url"
        }
    }
}
