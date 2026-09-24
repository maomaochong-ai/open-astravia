package org.vetta.android.domain.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class ToolCardStatus {
    @SerialName("generating") Generating,
    @SerialName("running") Running,
    @SerialName("done") Done,
    @SerialName("failed") Failed,
}

@Serializable
data class ToolCard(
    val toolCallId: String,
    val toolName: String,
    val status: ToolCardStatus,
    val args: String? = null,
    val result: String? = null,
    val label: String? = null,
    val durationMs: Double? = null,
)

@Serializable
data class AssistantTurn(
    val id: String,
    val text: String,
    val thinking: String,
    val tools: List<ToolCard>,
    val streaming: Boolean,
    val at: Long?,
    val error: String? = null,
)

/** A picture or file sent with a prompt from this phone, shown on its bubble. */
@Serializable
data class TranscriptAttachment(val kind: AttachmentKind, val name: String)

@Serializable
sealed interface TranscriptItem {
    val id: String
    val at: Long?

    @Serializable
    @SerialName("user")
    data class User(
        override val id: String,
        val text: String,
        override val at: Long?,
        val attachments: List<TranscriptAttachment> = emptyList(),
    ) : TranscriptItem

    @Serializable
    @SerialName("assistant")
    data class Assistant(val turn: AssistantTurn) : TranscriptItem {
        override val id: String
            get() = turn.id
        override val at: Long?
            get() = turn.at
    }

    @Serializable
    @SerialName("marker")
    data class Marker(override val id: String, val text: String, override val at: Long?) : TranscriptItem
}

data class TranscriptState(
    val items: List<TranscriptItem>,
    val sessionState: RemoteSessionState,
    val pendingQuestion: RemoteQuestionRequest?,
    /** Set after `session.resync`; the owner must refetch history before trusting `items`. */
    val stale: Boolean,
    val loaded: Boolean,
) {
    companion object {
        val Empty =
            TranscriptState(
                items = emptyList(),
                sessionState = RemoteSessionState(RemoteSessionStatus.Idle),
                pendingQuestion = null,
                stale = false,
                loaded = false,
            )
    }
}

sealed interface TranscriptAction {
    data class History(val entries: List<RemoteTranscriptEntry>, val state: RemoteSessionState) : TranscriptAction

    data class Message(val event: RemoteMessageEvent) : TranscriptAction

    data class Tool(val event: RemoteToolEvent) : TranscriptAction

    data class State(val state: RemoteSessionState) : TranscriptAction

    data class Question(val request: RemoteQuestionRequest) : TranscriptAction

    data class QuestionResolved(val requestId: String) : TranscriptAction

    data class LocalUser(
        val text: String,
        val at: Long,
        val attachments: List<TranscriptAttachment> = emptyList(),
    ) : TranscriptAction

    data object Resync : TranscriptAction
}

/**
 * Pure reducer: history snapshot plus live events → chat view model (port of the
 * iOS `Transcript.swift`). The clock and the local-id counter are the only state,
 * so tests inject a fixed clock.
 */
class TranscriptReducer(private val now: () -> Long) {
    private var localCounter = 0

    private fun nextLocalId(prefix: String): String {
        localCounter += 1
        return "$prefix-${now().toString(36)}-$localCounter"
    }

    fun reduce(state: TranscriptState, action: TranscriptAction): TranscriptState =
        when (action) {
            is TranscriptAction.History -> {
                val items = keepingAttachments(action.entries.map(::fromHistoryEntry), state.items).toMutableList()
                // A snapshot taken mid-turn ends in the partial reply; later deltas must
                // continue that bubble instead of opening a second one below it.
                val last = items.lastOrNull()
                if (action.state.status.isActive && last is TranscriptItem.Assistant) {
                    items[items.lastIndex] = TranscriptItem.Assistant(last.turn.copy(streaming = true))
                }
                TranscriptState(
                    items = items,
                    sessionState = action.state,
                    pendingQuestion = action.state.pendingQuestion,
                    stale = false,
                    loaded = true,
                )
            }
            is TranscriptAction.LocalUser ->
                state.copy(items = state.items + TranscriptItem.User(nextLocalId("local-user"), action.text, action.at, action.attachments))
            is TranscriptAction.Message -> applyMessage(state, action.event)
            is TranscriptAction.Tool -> applyTool(state, action.event)
            is TranscriptAction.State -> applyState(state, action.state)
            is TranscriptAction.Question ->
                state.copy(
                    pendingQuestion = action.request,
                    sessionState = state.sessionState.copy(status = RemoteSessionStatus.WaitingInput, pendingQuestion = action.request),
                )
            is TranscriptAction.QuestionResolved ->
                if (state.pendingQuestion?.requestId != action.requestId) {
                    state
                } else {
                    state.copy(
                        pendingQuestion = null,
                        sessionState = state.sessionState.copy(status = RemoteSessionStatus.Running, pendingQuestion = null),
                    )
                }
            TranscriptAction.Resync -> TranscriptState.Empty.copy(sessionState = state.sessionState, stale = true)
        }

    private fun applyState(state: TranscriptState, incoming: RemoteSessionState): TranscriptState {
        val finished = !incoming.status.isActive
        // Only an answer or the end of the turn retires a question: the turn keeps
        // reporting "running" (usage, retries) while it waits, and older desktops
        // send that without the question.
        val question = incoming.pendingQuestion ?: if (finished) null else state.pendingQuestion
        // Most state events (completed, error, usage) leave the model out; keep what is known.
        var sessionState =
            incoming.copy(
                model = incoming.model ?: state.sessionState.model,
                modelKey = incoming.modelKey ?: state.sessionState.modelKey,
                thinkingLevel = incoming.thinkingLevel ?: state.sessionState.thinkingLevel,
                contextPercent = incoming.contextPercent ?: state.sessionState.contextPercent,
            )
        if (question != null) {
            sessionState = sessionState.copy(status = RemoteSessionStatus.WaitingInput, pendingQuestion = question)
        }
        var items = state.items
        if (finished) {
            val streaming = (state.items.lastOrNull() as? TranscriptItem.Assistant)?.turn?.streaming == true
            items = finalizeStreaming(state.items, incoming)
            // The turn failed before it wrote anything: the error is all there is to show.
            val message = incoming.error?.message
            if (!streaming && incoming.status == RemoteSessionStatus.Error && !message.isNullOrEmpty()) {
                items = items + TranscriptItem.Assistant(AssistantTurn(nextLocalId("error"), "", "", emptyList(), false, now(), message))
            }
        }
        return state.copy(items = items, sessionState = sessionState, pendingQuestion = question)
    }

    /**
     * The desktop's history does not know what this phone attached; a refetch
     * keeps those attachments on the matching user messages, in order.
     */
    private fun keepingAttachments(items: List<TranscriptItem>, previous: List<TranscriptItem>): List<TranscriptItem> {
        val known =
            previous
                .filterIsInstance<TranscriptItem.User>()
                .filter { it.attachments.isNotEmpty() }
                .map { it.text to it.attachments }
                .toMutableList()
        if (known.isEmpty()) return items
        return items.map { item ->
            if (item !is TranscriptItem.User || item.attachments.isNotEmpty()) return@map item
            val index = known.indexOfFirst { it.first == item.text }
            if (index < 0) item else item.copy(attachments = known.removeAt(index).second)
        }
    }

    private fun fromHistoryEntry(entry: RemoteTranscriptEntry): TranscriptItem =
        when (entry) {
            is RemoteTranscriptEntry.User -> TranscriptItem.User(entry.id, entry.text, entry.at)
            is RemoteTranscriptEntry.Assistant ->
                TranscriptItem.Assistant(
                    AssistantTurn(
                        id = entry.id,
                        text = entry.text,
                        thinking = entry.thinking.orEmpty(),
                        tools =
                            entry.toolCalls.map { call ->
                                ToolCard(
                                    toolCallId = call.toolCallId,
                                    toolName = call.toolName,
                                    status = if (call.isError) ToolCardStatus.Failed else ToolCardStatus.Done,
                                    args = call.args,
                                    result = call.result,
                                    durationMs = call.durationMs,
                                )
                            },
                        streaming = false,
                        at = entry.at,
                        error = entry.error,
                    ),
                )
            is RemoteTranscriptEntry.Marker -> TranscriptItem.Marker(entry.id, entry.text, entry.at)
        }

    private fun applyMessage(state: TranscriptState, event: RemoteMessageEvent): TranscriptState =
        when (event) {
            is RemoteMessageEvent.User -> {
                // The optimistic bubble for our own prompt is replaced by the desktop's
                // authoritative copy, which keeps the attachments only this phone knows about.
                val (items, attachments) = dropMatchingLocalUser(state.items, event.text)
                state.copy(items = items + TranscriptItem.User(nextLocalId("user"), event.text, event.at, attachments))
            }
            is RemoteMessageEvent.AssistantDelta -> updateStreaming(state) { it.copy(text = it.text + event.text) }
            is RemoteMessageEvent.ThinkingDelta -> updateStreaming(state) { it.copy(thinking = it.thinking + event.text) }
            is RemoteMessageEvent.TurnEnd -> state.copy(items = finalizeStreaming(state.items, state.sessionState))
        }

    private fun applyTool(state: TranscriptState, event: RemoteToolEvent): TranscriptState =
        updateStreaming(state) { turn ->
            val index = turn.tools.indexOfFirst { it.toolCallId == event.toolCallId }
            val existing = turn.tools.getOrNull(index)
            val merged =
                ToolCard(
                    toolCallId = event.toolCallId,
                    toolName = event.toolName,
                    status = statusForPhase(event.phase, existing?.status),
                    args = event.args ?: existing?.args,
                    result = event.result ?: existing?.result,
                    label = event.label ?: existing?.label,
                    durationMs = event.durationMs ?: existing?.durationMs,
                )
            turn.copy(tools = if (index >= 0) turn.tools.toMutableList().also { it[index] = merged } else turn.tools + merged)
        }

    private fun statusForPhase(phase: RemoteToolPhase, previous: ToolCardStatus?): ToolCardStatus =
        when (phase) {
            RemoteToolPhase.Generating -> previous ?: ToolCardStatus.Generating
            RemoteToolPhase.Started, RemoteToolPhase.Updated, RemoteToolPhase.Phase ->
                if (previous == ToolCardStatus.Done || previous == ToolCardStatus.Failed) previous else ToolCardStatus.Running
            RemoteToolPhase.Completed -> ToolCardStatus.Done
            RemoteToolPhase.Failed -> ToolCardStatus.Failed
        }

    private fun updateStreaming(state: TranscriptState, patch: (AssistantTurn) -> AssistantTurn): TranscriptState {
        val last = state.items.lastOrNull()
        if (last is TranscriptItem.Assistant && last.turn.streaming) {
            return state.copy(items = state.items.dropLast(1) + TranscriptItem.Assistant(patch(last.turn)))
        }
        val fresh = AssistantTurn(nextLocalId("assistant"), "", "", emptyList(), true, now(), null)
        return state.copy(items = state.items + TranscriptItem.Assistant(patch(fresh)))
    }

    private fun finalizeStreaming(items: List<TranscriptItem>, sessionState: RemoteSessionState): List<TranscriptItem> {
        val last = items.lastOrNull() as? TranscriptItem.Assistant ?: return items
        if (!last.turn.streaming) return items
        val failed = sessionState.status == RemoteSessionStatus.Error
        val turn =
            last.turn.copy(
                streaming = false,
                tools =
                    last.turn.tools.map { tool ->
                        if (tool.status == ToolCardStatus.Running || tool.status == ToolCardStatus.Generating) {
                            tool.copy(status = if (failed) ToolCardStatus.Failed else ToolCardStatus.Done)
                        } else {
                            tool
                        }
                    },
                error = if (failed && sessionState.error?.message != null) sessionState.error.message else last.turn.error,
            )
        val output = items.dropLast(1)
        if (turn.text.isEmpty() && turn.thinking.isEmpty() && turn.tools.isEmpty() && turn.error == null) return output
        return output + TranscriptItem.Assistant(turn)
    }

    private fun dropMatchingLocalUser(items: List<TranscriptItem>, text: String): Pair<List<TranscriptItem>, List<TranscriptAttachment>> {
        for (index in items.indices.reversed()) {
            when (val item = items[index]) {
                is TranscriptItem.Assistant -> continue
                is TranscriptItem.User ->
                    return if (item.id.startsWith("local-user") && item.text == text) {
                        items.toMutableList().also { it.removeAt(index) } to item.attachments
                    } else {
                        items to emptyList()
                    }
                is TranscriptItem.Marker -> return items to emptyList()
            }
        }
        return items to emptyList()
    }
}
