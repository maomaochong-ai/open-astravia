package org.vetta.android.domain.session

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

interface SessionStore {
    val sessions: StateFlow<List<ChatSession>>

    fun observeMessages(sessionId: String): Flow<List<LocalMessage>>

    suspend fun getSession(id: String): ChatSession?

    suspend fun getMessages(sessionId: String): List<LocalMessage>

    suspend fun createSession(
        title: String = DEFAULT_TITLE,
        modelId: String? = null,
        modelName: String? = null,
    ): ChatSession

    suspend fun updateSession(session: ChatSession)

    suspend fun deleteSession(id: String)

    suspend fun upsertMessage(message: LocalMessage)

    suspend fun replaceMessages(sessionId: String, messages: List<LocalMessage>)

    companion object {
        const val DEFAULT_TITLE = "新对话"
    }
}
