package org.vetta.android.domain.work

import org.vetta.android.domain.remote.AttachmentKind
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class IncomingShareTest {
    private fun file(name: String, bytes: Int = 10) = PromptAttachment(AttachmentKind.File, name, "text/plain", ByteArray(bytes))

    @Test
    fun sharedTextStartsAnEmptyDraftOrGoesOnItsOwnLineAfterWhatWasTyped() {
        assertEquals(PromptDraft("看看这篇文章 https://example.com"), IncomingShare("  看看这篇文章 https://example.com ").into(PromptDraft()).first)
        assertEquals(PromptDraft("总结一下\nhttps://example.com"), IncomingShare("https://example.com").into(PromptDraft("总结一下  ")).first)
    }

    @Test
    fun attachmentsGoInWhileThereIsRoomAndTheRestAreCounted() {
        val full = (1..PromptDraft.MAX_ATTACHMENTS).fold(PromptDraft()) { draft, n -> draft.adding(file("a$n")) }
        val (draft, left) = IncomingShare(attachments = listOf(file("more")), skipped = 1).into(full)
        assertEquals(PromptDraft.MAX_ATTACHMENTS, draft.attachments.size)
        assertEquals(2, left, "one that did not fit plus one the phone could not read")

        val (some, none) = IncomingShare(attachments = listOf(file("x"), file("y"))).into(PromptDraft("说明"))
        assertEquals(listOf("x", "y"), some.attachments.map { it.name })
        assertEquals(0, none)
    }

    @Test
    fun emptyOnlyWhenNothingCameAtAll() {
        assertTrue(IncomingShare().isEmpty)
        assertTrue(!IncomingShare(skipped = 1).isEmpty, "a share that could not be read still deserves a word")
    }
}
