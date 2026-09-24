package org.vetta.android.ui.work

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.vetta.android.domain.remote.RemoteQuestionAnswer
import org.vetta.android.domain.remote.RemoteSessionState
import org.vetta.android.domain.work.DesktopMirror
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.domain.work.ModelChoice
import org.vetta.android.domain.work.PromptDraft
import org.vetta.android.domain.work.SessionFilter

/** New Session's choices, kept to put back if starting the session fails. */
data class NewSessionStart(
    val draft: PromptDraft,
    val projectCwd: String?,
    val modelChoice: ModelChoice,
)

/** What the desktop screens can ask for; the view model runs each on the mirror. */
interface WorkActions {
    fun open(sessionId: String)

    fun send(sessionId: String, draft: PromptDraft)

    fun stop(sessionId: String)

    fun resync(sessionId: String)

    fun rename(sessionId: String, title: String)

    fun setPinned(sessionId: String, pinned: Boolean)

    fun delete(sessionId: String)

    /** Sends what changed between the session's state and the sheet's `next`. */
    fun configure(sessionId: String, next: ModelChoice, current: RemoteSessionState)

    fun setDraft(sessionId: String, draft: PromptDraft)

    /** Answers the question the desktop is waiting on, or cancels it. */
    fun respond(sessionId: String, requestId: String, answers: List<RemoteQuestionAnswer>, cancelled: Boolean = false)

    fun clearError()
}

/**
 * The desktop screens' view of [DesktopMirror]: its state, the composer drafts
 * (kept per session, so leaving a chat does not lose what was typed), and the
 * actions, each run on the view model's main-thread scope like the mirror itself.
 */
class WorkViewModel(private val mirror: DesktopMirror) : ViewModel(), WorkActions {
    val state: StateFlow<MirrorState> = mirror.state

    private val _drafts = MutableStateFlow<Map<String, PromptDraft>>(emptyMap())
    val drafts: StateFlow<Map<String, PromptDraft>> = _drafts.asStateFlow()

    private val _filter = MutableStateFlow(SessionFilter())
    val filter: StateFlow<SessionFilter> = _filter.asStateFlow()

    fun setFilter(filter: SessionFilter) {
        _filter.value = filter
    }

    /** Pull to refresh: the session list, then the projects it is filtered by. */
    suspend fun refresh() {
        mirror.refreshSessions()
    }

    fun reconnect() {
        mirror.refreshLink()
    }

    private var failedStart: NewSessionStart? = null

    /** What New Session had when its start failed, once; it opens again with it. */
    fun takeFailedStart(): NewSessionStart? = failedStart.also { failedStart = null }

    /** Readies New Session: the projects to start in and the models to start with. */
    suspend fun prepareNewSession() {
        mirror.refreshProjects()
        mirror.loadNewSessionModels()
    }

    /**
     * Opens the chat at once on a local id while the desktop creates the session
     * behind it; `onFailure` runs when the prompt did not go out. Null when there is no text.
     */
    fun startSession(start: NewSessionStart, onFailure: () -> Unit): String? {
        val id =
            mirror.startSession(
                text = start.draft.text,
                projectCwd = start.projectCwd,
                modelKey = start.modelChoice.modelKey,
                thinkingLevel = start.modelChoice.thinkingLevel,
                attachments = start.draft.attachments,
                onFailure = {
                    failedStart = start
                    onFailure()
                },
            ) ?: return null
        setDraft(NEW_SESSION_DRAFT, PromptDraft())
        return id
    }

    companion object {
        /** New Session's composer draft, kept like a chat's. */
        const val NEW_SESSION_DRAFT = "new-session"
    }

    override fun open(sessionId: String) {
        viewModelScope.launch {
            mirror.openSession(sessionId)
            mirror.loadModels(sessionId)
        }
    }

    override fun send(sessionId: String, draft: PromptDraft) {
        if (!draft.canSend) return
        setDraft(sessionId, PromptDraft())
        viewModelScope.launch {
            // Put back what was typed so a failed send is not lost.
            if (mirror.sendPrompt(sessionId, draft.text, attachments = draft.attachments) == null) setDraft(sessionId, draft)
        }
    }

    override fun stop(sessionId: String) {
        viewModelScope.launch { mirror.abort(sessionId) }
    }

    override fun resync(sessionId: String) {
        viewModelScope.launch { mirror.resync(sessionId) }
    }

    override fun rename(sessionId: String, title: String) {
        viewModelScope.launch { mirror.rename(sessionId, title) }
    }

    override fun setPinned(sessionId: String, pinned: Boolean) {
        viewModelScope.launch { mirror.setPinned(sessionId, pinned) }
    }

    override fun delete(sessionId: String) {
        viewModelScope.launch { mirror.deleteSession(sessionId) }
    }

    /**
     * A new model is sent with the level the sheet kept for it, so the desktop
     * does not fall back to that model's default under the sheet.
     */
    override fun configure(sessionId: String, next: ModelChoice, current: RemoteSessionState) {
        val modelChanged = next.modelKey != current.modelKey
        val modelKey = if (modelChanged) next.modelKey else null
        val level = if (modelChanged || next.thinkingLevel != current.thinkingLevel) next.thinkingLevel else null
        if (modelKey == null && level == null) return
        viewModelScope.launch { mirror.configure(sessionId, modelKey, level) }
    }

    override fun setDraft(sessionId: String, draft: PromptDraft) {
        _drafts.update { if (draft.text.isEmpty() && draft.attachments.isEmpty()) it - sessionId else it + (sessionId to draft) }
    }

    override fun respond(sessionId: String, requestId: String, answers: List<RemoteQuestionAnswer>, cancelled: Boolean) {
        viewModelScope.launch { mirror.respond(sessionId, requestId, answers, cancelled) }
    }

    override fun clearError() {
        mirror.clearError()
    }
}
