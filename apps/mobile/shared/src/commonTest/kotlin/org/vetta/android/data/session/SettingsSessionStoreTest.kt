package org.vetta.android.data.session

import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.runBlocking
import org.vetta.android.core.model.ChatRole
import org.vetta.android.domain.session.LocalMessage
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
}
