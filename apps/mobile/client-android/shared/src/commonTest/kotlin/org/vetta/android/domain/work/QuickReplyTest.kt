package org.vetta.android.domain.work

import org.vetta.android.domain.remote.RemoteQuestionAnswer
import org.vetta.android.domain.remote.RemoteQuestionItem
import org.vetta.android.domain.remote.RemoteQuestionOption
import org.vetta.android.domain.remote.RemoteQuestionRequest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class QuickReplyTest {
    private fun item(question: String, options: Int, multiSelect: Boolean = false) =
        RemoteQuestionItem(question, "头", (1..options).map { RemoteQuestionOption("选项$it", "") }, multiSelect)

    private fun request(vararg items: RemoteQuestionItem) = RemoteQuestionRequest("req-1", items.toList())

    @Test
    fun aSingleChoiceWithFewOptionsBecomesButtons() {
        val request = request(item(" 用哪个方案？ ", 3))
        assertTrue(QuickReply.canReply(request))
        assertEquals(listOf("选项1", "选项2", "选项3"), QuickReply.choices(request))
        assertEquals("用哪个方案？", QuickReply.prompt(request))
        assertEquals(listOf(RemoteQuestionAnswer(" 用哪个方案？ ", listOf("选项2"))), QuickReply.answer(request, "选项2"))
    }

    @Test
    fun tooManyOptionsOrSeveralPicksLeaveOnlyTyping() {
        assertEquals(emptyList(), QuickReply.choices(request(item("q", 4))))
        assertEquals(emptyList(), QuickReply.choices(request(item("q", 2, multiSelect = true))))
        assertTrue(QuickReply.canReply(request(item("q", 4))))
        assertEquals(listOf(RemoteQuestionAnswer("q", listOf("我自己写"))), QuickReply.answer(request(item("q", 0)), "  我自己写 "))
        assertNull(QuickReply.answer(request(item("q", 0)), "  "), "a blank reply is not an answer")
    }

    @Test
    fun severalQuestionsNeedTheApp() {
        val request = request(item("a", 2), item("b", 2))
        assertFalse(QuickReply.canReply(request))
        assertEquals(emptyList(), QuickReply.choices(request))
        assertNull(QuickReply.prompt(request))
        assertNull(QuickReply.answer(request, "x"))
    }
}
