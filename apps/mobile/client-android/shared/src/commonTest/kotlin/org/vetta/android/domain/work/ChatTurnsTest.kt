package org.vetta.android.domain.work

import org.vetta.android.domain.remote.AssistantTurn
import org.vetta.android.domain.remote.ToolCard
import org.vetta.android.domain.remote.ToolCardStatus
import org.vetta.android.domain.remote.TranscriptItem
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ChatTurnsTest {
    private fun reply(
        id: String,
        text: String = "",
        thinking: String = "",
        tools: List<ToolCard> = emptyList(),
        streaming: Boolean = false,
        error: String? = null,
    ): TranscriptItem = TranscriptItem.Assistant(AssistantTurn(id, text, thinking, tools, streaming, 1, error))

    private fun tool(id: String, status: ToolCardStatus = ToolCardStatus.Done) = ToolCard(id, "bash", status)

    private fun user(id: String, text: String) = TranscriptItem.User(id, text, 1)

    private fun turns(blocks: List<ChatBlock>): List<AgentTurn> = blocks.filterIsInstance<ChatBlock.Turn>().map { it.turn }

    @Test
    fun mergesEveryReplyBetweenTwoUserMessagesIntoOneTurn() {
        val blocks =
            ChatTurns.build(
                listOf(
                    user("u1", "查一下"),
                    reply("a1", thinking = "先看看", tools = listOf(tool("t1"))),
                    reply("a2", tools = listOf(tool("t2"))),
                    reply("a3", text = "查到了"),
                    user("u2", "谢谢"),
                    reply("a4", text = "不客气"),
                ),
            )
        assertEquals(listOf("u1", "a1", "u2", "a4"), blocks.map { it.id })
        val first = turns(blocks)[0]
        assertEquals(
            listOf(
                TurnSegment.Work("a1-work", listOf(WorkStep.Thinking("a1-thinking", "先看看"), WorkStep.Tool(tool("t1")), WorkStep.Tool(tool("t2")))),
                TurnSegment.Text("a3-text", "查到了"),
            ),
            first.segments,
        )
        assertEquals("查到了", first.conclusion)
    }

    @Test
    fun textBetweenToolRoundsClosesTheWorkGroup() {
        val turn =
            turns(
                ChatTurns.build(
                    listOf(reply("a1", text = "我先跑测试", tools = listOf(tool("t1"))), reply("a2", text = "修好了", tools = listOf(tool("t2")))),
                ),
            )[0]
        assertEquals(listOf("a1-work", "a1-text", "a2-work", "a2-text"), turn.segments.map { it.id })
        assertEquals("修好了", turn.conclusion, "the copy button takes the answer after the last work group")
    }

    @Test
    fun aMarkerEndsTheTurnButAnErrorStaysInside() {
        val blocks =
            ChatTurns.build(
                listOf(
                    reply("a1", text = "第一段"),
                    reply("a2", error = "rate limited"),
                    TranscriptItem.Marker("m1", "上下文已压缩", 3),
                    reply("a3", text = "继续"),
                ),
            )
        assertEquals(listOf("a1", "m1", "a3"), blocks.map { it.id })
        assertEquals(
            listOf(TurnSegment.Text("a1-text", "第一段"), TurnSegment.Error("a2-error", "rate limited", 1)),
            turns(blocks)[0].segments,
        )
    }

    @Test
    fun repeatedFailuresShowOnceWithACountAndARetryThatWorksHidesThem() {
        val failing =
            ChatTurns.build(
                listOf(
                    user("u1", "这是个什么项目"),
                    reply("a1", error = "Connection error."),
                    reply("a2", error = "Connection error."),
                    reply("a3", error = "Connection error."),
                ),
            )
        assertEquals(listOf("u1", "a1"), failing.map { it.id }, "one turn, not one per attempt")
        assertEquals(listOf(TurnSegment.Error("a1-error", "Connection error.", 3)), turns(failing)[0].segments)

        val recovered =
            ChatTurns.build(
                listOf(reply("a1", error = "Connection error."), reply("a2", error = "Connection error."), reply("a3", text = "这是一个 Electron 项目")),
            )
        assertEquals(listOf(TurnSegment.Text("a3-text", "这是一个 Electron 项目")), turns(recovered)[0].segments)
    }

    @Test
    fun aWorkingSessionAlwaysShowsATurnToWatch() {
        val justSent = ChatTurns.build(listOf(user("u1", "你好")), waiting = true)
        assertEquals(listOf("u1", ChatTurns.PENDING_TURN_ID), justSent.map { it.id })
        assertTrue(turns(justSent)[0].streaming && turns(justSent)[0].segments.isEmpty())

        val retrying = ChatTurns.build(listOf(user("u1", "你好"), reply("a1", error = "Connection error.")), waiting = true)
        assertEquals(listOf("u1", "a1"), retrying.map { it.id }, "a retry keeps the same turn, now live again")
        assertTrue(turns(retrying)[0].streaming)
        assertEquals(1, ChatTurns.build(listOf(user("u1", "你好"))).size)
    }

    @Test
    fun followsTheLiveStepWhileStreaming() {
        val running = ToolCard("t2", "web_search", ToolCardStatus.Running)
        val turn = turns(ChatTurns.build(listOf(reply("a1", tools = listOf(tool("t1"))), reply("a2", tools = listOf(running), streaming = true))))[0]
        assertTrue(turn.streaming)
        assertEquals(WorkStep.Tool(running), turn.activity)
        assertEquals("", turn.conclusion)
        assertNull(turns(ChatTurns.build(listOf(reply("a1", text = "好", tools = listOf(tool("t1"))))))[0].activity)
    }

    @Test
    fun skipsBlankThinkingAndText() {
        val turn = turns(ChatTurns.build(listOf(reply("a1", text = "  \n", thinking = " ", tools = listOf(tool("t1"))))))[0]
        assertEquals(listOf(TurnSegment.Work("a1-work", listOf(WorkStep.Tool(tool("t1"))))), turn.segments)
    }
}
