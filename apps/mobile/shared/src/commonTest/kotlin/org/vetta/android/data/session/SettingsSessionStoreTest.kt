package org.vetta.android.data.session

import com.russhwolf.settings.MapSettings
import com.russhwolf.settings.set
import kotlinx.coroutines.runBlocking
import org.vetta.android.core.model.ChatRole
import org.vetta.android.core.model.ChatQuestion
import org.vetta.android.core.model.ChatQuestionOption
import org.vetta.android.domain.session.LocalMessage
import org.vetta.android.domain.session.ConversationOrigin
import org.vetta.android.domain.session.MessageStatus
import org.vetta.android.domain.session.PendingQuestion
import org.vetta.android.domain.session.SessionStore
import org.vetta.android.domain.session.ToolTrace
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SettingsSessionStoreTest {
    @Test
    fun createAndTitleFromFirstUserMessage() =
        runBlocking {
            val store = SettingsSessionStore(MapSettings())
            val session = store.createSession()
            assertEquals(SessionStore.DEFAULT_TITLE, session.title)

            store.upsertMessage(
                LocalMessage(
                    id = "m1",
                    sessionId = session.id,
                    role = ChatRole.User,
                    content = "帮我写一封邮件给同事说明进度",
                    status = MessageStatus.Complete,
                    createdAtEpochMs = 1,
                ),
            )
            val updated = store.getSession(session.id)
            assertEquals("帮我写一封邮件给同事说明进度", updated?.title)
            assertTrue(store.getMessages(session.id).size == 1)
        }

    @Test
    fun remoteMetadataPersistsAndLegacySessionsDefaultToCloud() =
        runBlocking {
            val settings = MapSettings()
            val firstStore = SettingsSessionStore(settings)
            val remote =
                firstStore.createSession(
                    title = "Desktop chat",
                    origin = ConversationOrigin.Desktop,
                    remoteDeviceId = "desktop-1",
                    remoteSessionId = "remote-session-1",
                )

            val restored = SettingsSessionStore(settings).getSession(remote.id)
            assertEquals(ConversationOrigin.Desktop, restored?.origin)
            assertEquals("desktop-1", restored?.remoteDeviceId)
            assertEquals("remote-session-1", restored?.remoteSessionId)

            settings["vetta.session.index"] =
                """{"items":[{"id":"legacy","title":"Legacy","createdAtEpochMs":1,"updatedAtEpochMs":2}]}"""
            val legacy = SettingsSessionStore(settings).getSession("legacy")
            assertEquals(ConversationOrigin.Cloud, legacy?.origin)
            assertEquals(null, legacy?.remoteDeviceId)
        }

    @Test
    fun pendingQuestionPersistsWithAssistantMessage() =
        runBlocking {
            val settings = MapSettings()
            val firstStore = SettingsSessionStore(settings)
            val session = firstStore.createSession(origin = ConversationOrigin.Desktop)
            val pending =
                PendingQuestion(
                    sessionId = session.id,
                    requestId = "request-1",
                    questions =
                        listOf(
                            ChatQuestion(
                                question = "继续吗？",
                                options = listOf(ChatQuestionOption("继续", "继续执行当前任务")),
                            ),
                        ),
                )
            firstStore.upsertMessage(
                LocalMessage(
                    id = "assistant-1",
                    sessionId = session.id,
                    role = ChatRole.Assistant,
                    content = "",
                    status = MessageStatus.Streaming,
                    createdAtEpochMs = 1,
                    pendingQuestion = pending,
                ),
            )

            val restored = SettingsSessionStore(settings).getMessages(session.id).single().pendingQuestion
            assertEquals(pending, restored)
        }

    @Test
    fun toolPhaseLabelPersistsWithAssistantMessage() =
        runBlocking {
            val settings = MapSettings()
            val store = SettingsSessionStore(settings)
            val session = store.createSession(origin = ConversationOrigin.Desktop)
            store.upsertMessage(
                LocalMessage(
                    id = "assistant-tool",
                    sessionId = session.id,
                    role = ChatRole.Assistant,
                    content = "读取完成",
                    status = MessageStatus.Complete,
                    createdAtEpochMs = 1,
                    toolEvents = listOf(ToolTrace("completed", "call-1", "read_file", phaseLabel = "读取文件内容")),
                ),
            )

            val restored = SettingsSessionStore(settings).getMessages(session.id).single().toolEvents.single()
            assertEquals("读取文件内容", restored.phaseLabel)
        }
}
