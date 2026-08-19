package org.vetta.android.data.session

import com.russhwolf.settings.MapSettings
import com.russhwolf.settings.set
import kotlinx.coroutines.runBlocking
import org.vetta.android.core.model.ChatRole
import org.vetta.android.domain.session.LocalMessage
import org.vetta.android.domain.session.ConversationOrigin
import org.vetta.android.domain.session.MessageStatus
import org.vetta.android.domain.session.SessionStore
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
}
