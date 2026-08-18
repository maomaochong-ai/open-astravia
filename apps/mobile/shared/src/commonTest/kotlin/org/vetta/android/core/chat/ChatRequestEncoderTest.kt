package org.vetta.android.core.chat

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.vetta.android.core.model.ChatContentPart
import org.vetta.android.core.model.ChatMessage
import org.vetta.android.core.model.ChatRole
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ChatRequestEncoderTest {
    @Test
    fun textOnlyUsesStringContent() {
        val msg = ChatMessage(ChatRole.User, "hello")
        val wire = ChatRequestEncoder.encodeMessage(msg)
        assertEquals("user", (wire["role"] as JsonPrimitive).content)
        val content = wire["content"]
        assertIs<JsonPrimitive>(content)
        assertEquals("hello", content.content)
        assertFalse(ChatRequestEncoder.contentHasImageParts(content))
    }

    @Test
    fun imageAttachmentProducesMultimodalParts() {
        // 1x1 PNG
        val pngBase64 =
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        val msg =
            ChatMessage(
                role = ChatRole.User,
                parts =
                    listOf(
                        ChatContentPart.Text("describe this"),
                        ChatContentPart.Image(mimeType = "image/png", base64Data = pngBase64),
                    ),
            )
        val wire = ChatRequestEncoder.encodeMessage(msg)
        val content = wire["content"]
        assertIs<JsonArray>(content)
        assertTrue(ChatRequestEncoder.contentHasImageParts(content))
        val types =
            content.mapNotNull { el ->
                ((el as? JsonObject)?.get("type") as? JsonPrimitive)?.content
            }
        assertTrue(types.contains("text"))
        assertTrue(types.contains("image_url"))
        val imagePart = content.first { ((it as JsonObject)["type"] as JsonPrimitive).content == "image_url" } as JsonObject
        val url =
            ((imagePart["image_url"] as JsonObject)["url"] as JsonPrimitive).content
        assertTrue(url.startsWith("data:image/png;base64,"))
        assertTrue(url.contains(pngBase64))
    }

    @Test
    fun encodeMessagesPreservesOrder() {
        val messages =
            listOf(
                ChatMessage(ChatRole.User, "a"),
                ChatMessage(ChatRole.Assistant, "b"),
            )
        val wires = ChatRequestEncoder.encodeMessages(messages)
        assertEquals(2, wires.size)
        assertEquals("user", (wires[0]["role"] as JsonPrimitive).content)
        assertEquals("assistant", (wires[1]["role"] as JsonPrimitive).content)
    }
}
