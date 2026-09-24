package org.vetta.android.domain.remote

import org.vetta.android.domain.work.ChatTurns
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TranscriptReducerTest {
    private val reducer = TranscriptReducer(now = { 1_000L })

    private fun run(vararg actions: TranscriptAction, from: TranscriptState = TranscriptState.Empty): TranscriptState =
        actions.fold(from, reducer::reduce)

    private fun state(status: RemoteSessionStatus, error: RemoteSessionError? = null, contextPercent: Double? = null, detail: String? = null) =
        TranscriptAction.State(RemoteSessionState(status, detail = detail, error = error, contextPercent = contextPercent))

    private fun assistant(item: TranscriptItem?): AssistantTurn? = (item as? TranscriptItem.Assistant)?.turn

    private val question =
        RemoteQuestionRequest(
            "q1",
            listOf(RemoteQuestionItem("继续？", "确认", listOf(RemoteQuestionOption("是", "")), false)),
        )

    @Test
    fun loadsHistory() {
        val loaded =
            run(
                TranscriptAction.History(
                    listOf(
                        RemoteTranscriptEntry.User("u1", "帮我整理", 1),
                        RemoteTranscriptEntry.Assistant("a1", "好的", "先搜索", listOf(RemoteToolCallSummary("t1", "web_search", "{}", "ok")), null, null),
                        RemoteTranscriptEntry.Marker("m1", "上下文已压缩", null),
                    ),
                    RemoteSessionState(RemoteSessionStatus.Idle),
                ),
            )
        assertTrue(loaded.loaded)
        assertEquals(3, loaded.items.size)
        assertEquals(ToolCardStatus.Done, assistant(loaded.items[1])?.tools?.first()?.status)
        assertEquals("先搜索", assistant(loaded.items[1])?.thinking)
    }

    @Test
    fun streamsIntoOneBubbleThenFinalizes() {
        val streamed =
            run(
                TranscriptAction.Message(RemoteMessageEvent.User("hi", 1)),
                state(RemoteSessionStatus.Running),
                TranscriptAction.Message(RemoteMessageEvent.ThinkingDelta("想")),
                TranscriptAction.Message(RemoteMessageEvent.AssistantDelta("你")),
                TranscriptAction.Message(RemoteMessageEvent.AssistantDelta("好")),
                TranscriptAction.Message(RemoteMessageEvent.TurnEnd(2)),
                state(RemoteSessionStatus.Completed),
            )
        assertEquals(2, streamed.items.size)
        val turn = assistant(streamed.items[1])
        assertEquals("你好", turn?.text)
        assertEquals("想", turn?.thinking)
        assertEquals(false, turn?.streaming)
    }

    @Test
    fun keepsThisPhonesAttachmentsWhenHistoryIsRefetched() {
        val photo = TranscriptAttachment(AttachmentKind.Image, "photo-1.jpg")
        val sent = run(TranscriptAction.LocalUser("看这张图", 1, listOf(photo)))
        val refetched =
            run(
                TranscriptAction.History(
                    listOf(RemoteTranscriptEntry.User("u0", "更早的", 0), RemoteTranscriptEntry.User("u1", "看这张图", 1)),
                    RemoteSessionState(RemoteSessionStatus.Running),
                ),
                from = sent,
            )
        assertEquals(listOf("u0", "u1"), refetched.items.map { it.id })
        assertEquals(listOf(photo), (refetched.items[1] as TranscriptItem.User).attachments)
        assertTrue((refetched.items[0] as TranscriptItem.User).attachments.isEmpty())
    }

    @Test
    fun replacesTheOptimisticLocalBubble() {
        val replaced = run(TranscriptAction.LocalUser("同样的话", 1), TranscriptAction.Message(RemoteMessageEvent.User("同样的话", 2)))
        assertEquals(1, replaced.items.size)
        assertEquals(2L, replaced.items.first().at)
    }

    @Test
    fun tracksToolCardsThroughTheirPhases() {
        val base =
            run(
                state(RemoteSessionStatus.Running),
                TranscriptAction.Tool(RemoteToolEvent("t1", "web_search", RemoteToolPhase.Generating)),
                TranscriptAction.Tool(RemoteToolEvent("t1", "web_search", RemoteToolPhase.Started, args = """{"q":"x"}""")),
                TranscriptAction.Tool(RemoteToolEvent("t1", "web_search", RemoteToolPhase.Updated, result = "partial")),
                TranscriptAction.Tool(RemoteToolEvent("t2", "read", RemoteToolPhase.Started)),
            )
        val streaming = assistant(base.items.first())
        assertEquals(listOf(ToolCardStatus.Running, ToolCardStatus.Running), streaming?.tools?.map { it.status })
        assertEquals("""{"q":"x"}""", streaming?.tools?.first()?.args)
        assertEquals("partial", streaming?.tools?.first()?.result)
        val done =
            run(
                TranscriptAction.Tool(RemoteToolEvent("t1", "web_search", RemoteToolPhase.Completed, result = "200 OK", durationMs = 12.0)),
                TranscriptAction.Tool(RemoteToolEvent("t2", "read", RemoteToolPhase.Failed, result = "ENOENT")),
                TranscriptAction.Message(RemoteMessageEvent.AssistantDelta("done")),
                state(RemoteSessionStatus.Completed),
                from = base,
            )
        val finished = assistant(done.items.first())
        assertEquals(listOf(ToolCardStatus.Done, ToolCardStatus.Failed), finished?.tools?.map { it.status })
        assertEquals(12.0, finished?.tools?.first()?.durationMs)
        assertEquals(false, finished?.streaming)
    }

    @Test
    fun surfacesAndClearsAPendingQuestion() {
        val asked = run(state(RemoteSessionStatus.Running), TranscriptAction.Question(question))
        assertEquals("q1", asked.pendingQuestion?.requestId)
        assertEquals(RemoteSessionStatus.WaitingInput, asked.sessionState.status)
        val resolved = run(TranscriptAction.QuestionResolved("q1"), from = asked)
        assertNull(resolved.pendingQuestion)
        assertEquals(RemoteSessionStatus.Running, resolved.sessionState.status)
        assertEquals("q1", run(TranscriptAction.QuestionResolved("other"), from = asked).pendingQuestion?.requestId)
    }

    @Test
    fun keepsTheModelWhenAStateEventLeavesItOut() {
        val configured =
            run(TranscriptAction.State(RemoteSessionState(RemoteSessionStatus.Idle, model = "GLM 5", modelKey = "zai/glm-5", thinkingLevel = "max")))
        val later = run(state(RemoteSessionStatus.Running, contextPercent = 30.0), state(RemoteSessionStatus.Completed), from = configured)
        assertEquals("GLM 5", later.sessionState.model)
        assertEquals("zai/glm-5", later.sessionState.modelKey)
        assertEquals("max", later.sessionState.thinkingLevel)
        assertEquals(30.0, later.sessionState.contextPercent)
        assertEquals(RemoteSessionStatus.Completed, later.sessionState.status)
        val switched =
            run(
                TranscriptAction.State(RemoteSessionState(RemoteSessionStatus.Idle, modelKey = "anthropic/claude-fable-5-1", thinkingLevel = "high")),
                from = later,
            )
        assertEquals("anthropic/claude-fable-5-1", switched.sessionState.modelKey)
    }

    @Test
    fun showsAFailureEvenWhenTheTurnWroteNothing() {
        val failure = RemoteSessionError("turn_failed", "Connection error.")
        val failed =
            run(
                TranscriptAction.LocalUser("这是个什么项目", 1),
                state(RemoteSessionStatus.Running),
                state(RemoteSessionStatus.Error, error = failure),
                state(RemoteSessionStatus.Running, detail = "retry 1/3"),
                state(RemoteSessionStatus.Error, error = failure),
                TranscriptAction.Message(RemoteMessageEvent.TurnEnd(3)),
                state(RemoteSessionStatus.Completed),
            )
        // Each attempt is recorded; the chat merges them into one line.
        assertEquals(listOf("Connection error.", "Connection error."), failed.items.mapNotNull { assistant(it)?.error })
        assertEquals(2, ChatTurns.build(failed.items).size)
    }

    @Test
    fun keepsAPendingQuestionWhileTheTurnReportsRunning() {
        val asked = run(state(RemoteSessionStatus.Running), TranscriptAction.Question(question))
        val usage = run(state(RemoteSessionStatus.Running, contextPercent = 40.0), from = asked)
        assertEquals("q1", usage.pendingQuestion?.requestId, "usage updates arrive while the turn waits on the answer")
        assertEquals(RemoteSessionStatus.WaitingInput, usage.sessionState.status)
        assertEquals(40.0, usage.sessionState.contextPercent)
        assertNull(run(state(RemoteSessionStatus.Aborted), from = usage).pendingQuestion, "the end of the turn retires the question")
        val answered = run(TranscriptAction.QuestionResolved("q1"), state(RemoteSessionStatus.Running), from = usage)
        assertNull(answered.pendingQuestion)
        assertEquals(RemoteSessionStatus.Running, answered.sessionState.status)
    }

    @Test
    fun marksTheTranscriptStaleOnResync() {
        val resynced = run(TranscriptAction.Message(RemoteMessageEvent.User("hi", 1)), state(RemoteSessionStatus.Running), TranscriptAction.Resync)
        assertTrue(resynced.items.isEmpty())
        assertTrue(resynced.stale)
        assertEquals(RemoteSessionStatus.Running, resynced.sessionState.status)
    }

    @Test
    fun attachesTheErrorToTheStreamingBubble() {
        val failed =
            run(
                state(RemoteSessionStatus.Running),
                TranscriptAction.Message(RemoteMessageEvent.AssistantDelta("部分")),
                TranscriptAction.Tool(RemoteToolEvent("t1", "bash", RemoteToolPhase.Started)),
                state(RemoteSessionStatus.Error, error = RemoteSessionError("internal_error", "boom")),
            )
        assertEquals("boom", assistant(failed.items.first())?.error)
        assertEquals(ToolCardStatus.Failed, assistant(failed.items.first())?.tools?.first()?.status)
    }

    @Test
    fun continuesAPartialReplyFromAMidTurnHistorySnapshot() {
        val continued =
            run(
                TranscriptAction.History(
                    listOf(RemoteTranscriptEntry.User("u1", "hi", 1), RemoteTranscriptEntry.Assistant("a1", "部分", null, emptyList(), 2, null)),
                    RemoteSessionState(RemoteSessionStatus.Running),
                ),
                TranscriptAction.Message(RemoteMessageEvent.AssistantDelta("回复")),
                TranscriptAction.Message(RemoteMessageEvent.TurnEnd(3)),
                state(RemoteSessionStatus.Completed),
            )
        assertEquals(2, continued.items.size)
        assertEquals("部分回复", assistant(continued.items.last())?.text)
        assertFalse(assistant(continued.items.last())!!.streaming)
        val idle =
            run(
                TranscriptAction.History(
                    listOf(RemoteTranscriptEntry.Assistant("a1", "完", null, emptyList(), 2, null)),
                    RemoteSessionState(RemoteSessionStatus.Idle),
                ),
            )
        assertFalse(assistant(idle.items.last())!!.streaming)
    }

    @Test
    fun dropsAnEmptyStreamingBubbleWhenTheTurnEnds() {
        val ended = run(TranscriptAction.Message(RemoteMessageEvent.AssistantDelta("")), TranscriptAction.Message(RemoteMessageEvent.TurnEnd(1)))
        assertTrue(ended.items.isEmpty())
    }
}
