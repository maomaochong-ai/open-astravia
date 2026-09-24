package org.vetta.android.domain.chat

import org.vetta.android.core.model.ChatRole
import org.vetta.android.domain.session.LocalMessage
import org.vetta.android.domain.session.MessageImage
import org.vetta.android.domain.session.MessageStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RetryTurnTest {
    private val png =
        MessageImage(
            id = "img-1",
            mimeType = "image/png",
            fileName = "a.png",
            base64Data = "iVBORw0KGgo=",
        )

    @Test
    fun imageOnlyFailedTurnRestoresImagesAndEmptyDraft() {
        val user =
            LocalMessage(
                id = "u1",
                sessionId = "s",
                role = ChatRole.User,
                content = "",
                status = MessageStatus.Complete,
                createdAtEpochMs = 1,
                images = listOf(png),
            )
        val assistant =
            LocalMessage(
                id = "a1",
                sessionId = "s",
                role = ChatRole.Assistant,
                content = "",
                status = MessageStatus.Error,
                createdAtEpochMs = 2,
                errorMessage = "fail",
            )
        val turn = prepareRetryTurn(listOf(user, assistant))
        assertNotNull(turn)
        assertEquals("", turn.draft)
        assertEquals(listOf(png), turn.images)
        assertTrue(turn.remainingMessages.isEmpty())
    }

    @Test
    fun textPlusImageRetryKeepsBoth() {
        val prior =
            LocalMessage(
                id = "u0",
                sessionId = "s",
                role = ChatRole.User,
                content = "prior",
                status = MessageStatus.Complete,
                createdAtEpochMs = 0,
            )
        val user =
            LocalMessage(
                id = "u1",
                sessionId = "s",
                role = ChatRole.User,
                content = "see image",
                status = MessageStatus.Complete,
                createdAtEpochMs = 1,
                images = listOf(png),
            )
        val assistant =
            LocalMessage(
                id = "a1",
                sessionId = "s",
                role = ChatRole.Assistant,
                content = "partial",
                status = MessageStatus.Aborted,
                createdAtEpochMs = 2,
            )
        val turn = prepareRetryTurn(listOf(prior, user, assistant))
        assertNotNull(turn)
        assertEquals("see image", turn.draft)
        assertEquals(1, turn.images.size)
        assertEquals("img-1", turn.images.single().id)
        assertEquals(listOf(prior), turn.remainingMessages)
    }

    @Test
    fun noFailedAssistantReturnsNull() {
        val user =
            LocalMessage(
                id = "u1",
                sessionId = "s",
                role = ChatRole.User,
                content = "hi",
                status = MessageStatus.Complete,
                createdAtEpochMs = 1,
            )
        val assistant =
            LocalMessage(
                id = "a1",
                sessionId = "s",
                role = ChatRole.Assistant,
                content = "ok",
                status = MessageStatus.Complete,
                createdAtEpochMs = 2,
            )
        assertNull(prepareRetryTurn(listOf(user, assistant)))
    }

    @Test
    fun sessionChangeClearsPendingPolicy() {
        assertTrue(shouldClearPendingImagesOnSessionChange("s1", "s2"))
        assertTrue(shouldClearPendingImagesOnSessionChange("s1", null))
        assertTrue(shouldClearPendingImagesOnSessionChange(null, "s1"))
        assertTrue(!shouldClearPendingImagesOnSessionChange("s1", "s1"))
        assertTrue(!shouldClearPendingImagesOnSessionChange(null, null))
    }
}
