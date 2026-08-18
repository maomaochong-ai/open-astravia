package org.vetta.android.core

import kotlinx.coroutines.flow.Flow
import org.vetta.android.core.api.VettaApi
import org.vetta.android.core.model.ChatMessage
import org.vetta.android.core.model.ChatStreamEvent

class ChatRepository internal constructor(
    private val api: VettaApi,
) {
    /**
     * 通过 Vetta Gateway 发起 OpenAI 兼容流式对话。
     *
     * @param model 必须使用 go-models 下发的 [org.vetta.android.core.model.LlmModel.id]（路由 key）
     */
    fun stream(
        model: String,
        messages: List<ChatMessage>,
        temperature: Double? = null,
    ): Flow<ChatStreamEvent> = api.streamChat(model, messages, temperature)
}
