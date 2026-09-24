package org.vetta.android.domain.work

import org.vetta.android.domain.remote.AssistantTurn
import org.vetta.android.domain.remote.ToolCard
import org.vetta.android.domain.remote.ToolCardStatus
import org.vetta.android.domain.remote.TranscriptAttachment
import org.vetta.android.domain.remote.TranscriptItem

/** One step of an agent's work, shown as a row inside a folded work group. */
sealed interface WorkStep {
    val id: String

    data class Thinking(override val id: String, val text: String) : WorkStep

    data class Tool(val card: ToolCard) : WorkStep {
        override val id: String
            get() = card.toolCallId
    }

    val pending: Boolean
        get() = this is Tool && (card.status == ToolCardStatus.Running || card.status == ToolCardStatus.Generating)
}

/**
 * A piece of a turn in display order: thinking and tools fold together until
 * the agent writes text, which closes the group (as the desktop's work stages do).
 */
sealed interface TurnSegment {
    val id: String

    data class Work(override val id: String, val steps: List<WorkStep>) : TurnSegment

    data class Text(override val id: String, val text: String) : TurnSegment

    /** `count` > 1 when the same failure repeated, e.g. over automatic retries. */
    data class Error(override val id: String, val message: String, val count: Int) : TurnSegment
}

/** Everything the agent did between two user messages, merged into one turn. */
data class AgentTurn(
    val id: String,
    val segments: List<TurnSegment>,
    val streaming: Boolean,
    val startedAt: Long?,
) {
    /** The closing answer, for the copy button: the text after the last work group. */
    val conclusion: String
        get() {
            val texts = ArrayDeque<String>()
            for (segment in segments.asReversed()) {
                when (segment) {
                    is TurnSegment.Text -> texts.addFirst(segment.text)
                    is TurnSegment.Error -> continue
                    is TurnSegment.Work -> break
                }
            }
            return texts.joinToString("\n\n")
        }

    /** What the agent is doing right now, for the live group title. */
    val activity: WorkStep?
        get() {
            if (!streaming) return null
            val work = segments.lastOrNull() as? TurnSegment.Work ?: return null
            return work.steps.lastOrNull { it.pending } ?: work.steps.lastOrNull()
        }
}

sealed interface ChatBlock {
    val id: String

    data class User(
        override val id: String,
        val text: String,
        val at: Long?,
        val attachments: List<TranscriptAttachment>,
    ) : ChatBlock

    data class Marker(override val id: String, val text: String, val at: Long?) : ChatBlock

    data class Turn(val turn: AgentTurn) : ChatBlock {
        override val id: String
            get() = turn.id
    }
}

object ChatTurns {
    /** The turn shown while a session works but has written nothing yet. */
    const val PENDING_TURN_ID = "pending-turn"

    /**
     * Merges consecutive assistant items into one turn. A user message or a
     * marker (e.g. compaction) ends the turn; errors stay inside it. `waiting`
     * means the session is working: a turn with nothing to show yet still
     * appears, so a sent message never sits there without feedback.
     */
    fun build(items: List<TranscriptItem>, waiting: Boolean = false): List<ChatBlock> {
        val blocks = mutableListOf<ChatBlock>()
        for (item in items) {
            when (item) {
                is TranscriptItem.User -> blocks += ChatBlock.User(item.id, item.text, item.at, item.attachments)
                is TranscriptItem.Marker -> blocks += ChatBlock.Marker(item.id, item.text, item.at)
                is TranscriptItem.Assistant -> {
                    val reply = item.turn
                    val existing = blocks.lastOrNull() as? ChatBlock.Turn
                    if (existing != null) blocks.removeAt(blocks.lastIndex)
                    val turn = existing?.turn ?: AgentTurn(reply.id, emptyList(), false, reply.at)
                    blocks += ChatBlock.Turn(append(reply, turn).copy(streaming = reply.streaming))
                }
            }
        }
        if (waiting) {
            val last = blocks.lastOrNull()
            if (last is ChatBlock.Turn) {
                blocks[blocks.lastIndex] = ChatBlock.Turn(last.turn.copy(streaming = true))
            } else {
                blocks += ChatBlock.Turn(AgentTurn(PENDING_TURN_ID, emptyList(), true, null))
            }
        }
        return blocks
    }

    private fun append(reply: AssistantTurn, turn: AgentTurn): AgentTurn {
        val segments = turn.segments.toMutableList()
        val steps = mutableListOf<WorkStep>()
        if (reply.thinking.isNotBlank()) steps += WorkStep.Thinking("${reply.id}-thinking", reply.thinking)
        steps += reply.tools.map(WorkStep::Tool)
        val hasText = reply.text.isNotBlank()
        if (steps.isNotEmpty() || hasText) {
            // New output means the attempts that failed before it were retried
            // successfully; like the desktop, those failures are dropped.
            while (segments.lastOrNull() is TurnSegment.Error) segments.removeAt(segments.lastIndex)
        }
        if (steps.isNotEmpty()) {
            val previous = segments.lastOrNull() as? TurnSegment.Work
            if (previous != null) {
                segments[segments.lastIndex] = previous.copy(steps = previous.steps + steps)
            } else {
                segments += TurnSegment.Work("${reply.id}-work", steps)
            }
        }
        if (hasText) segments += TurnSegment.Text("${reply.id}-text", reply.text)
        val error = reply.error
        if (error != null) {
            val previous = segments.lastOrNull() as? TurnSegment.Error
            if (previous != null && previous.message == error) {
                segments[segments.lastIndex] = previous.copy(count = previous.count + 1)
            } else {
                segments += TurnSegment.Error("${reply.id}-error", error, 1)
            }
        }
        return turn.copy(segments = segments)
    }
}
