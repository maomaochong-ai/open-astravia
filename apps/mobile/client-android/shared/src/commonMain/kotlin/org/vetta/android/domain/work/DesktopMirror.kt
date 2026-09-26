package org.vetta.android.domain.work

import com.russhwolf.settings.Settings
import com.russhwolf.settings.set
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.vetta.android.data.remote.SessionCache
import org.vetta.android.domain.remote.RemoteApi
import org.vetta.android.domain.remote.RemoteMessageEvent
import org.vetta.android.domain.remote.RemoteModelOption
import org.vetta.android.domain.remote.RemoteProjectSummary
import org.vetta.android.domain.remote.RemoteQuestionAnswer
import org.vetta.android.domain.remote.RemoteSessionState
import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.RemoteSessionSummary
import org.vetta.android.domain.remote.TranscriptAction
import org.vetta.android.domain.remote.TranscriptReducer
import org.vetta.android.domain.remote.TranscriptState
import org.vetta.android.domain.remote.desktopViewerUrl
import org.vetta.android.domain.remote.connection.NoopRemoteLogger
import org.vetta.android.domain.remote.connection.RemoteLogger
import org.vetta.android.domain.remote.link.DesktopLink
import org.vetta.android.domain.remote.link.DesktopLinkOptions
import org.vetta.android.domain.remote.link.LinkOfflineException
import org.vetta.android.domain.remote.link.LinkSnapshot
import org.vetta.android.domain.remote.link.P2pRemoteTransportFactory
import org.vetta.android.domain.remote.link.RemoteTransportFactory
import org.vetta.android.domain.remote.pairing.DesktopRecord
import org.vetta.android.domain.remote.pairing.PairingFlow
import org.vetta.android.domain.remote.pairing.PairingFlowOptions
import org.vetta.android.domain.remote.pairing.PairingPhase
import org.vetta.android.domain.remote.pairing.PairingStore
import org.vetta.android.domain.remote.pairing.SecretStore
import org.vetta.android.domain.remote.pairing.StoredDesktop
import org.vetta.android.domain.remote.protocol.RemoteCrypto
import org.vetta.android.domain.remote.protocol.RemoteEvent
import org.vetta.android.domain.remote.protocol.RemoteEventName
import org.vetta.android.domain.remote.protocol.RemoteRequestMethod
import kotlin.random.Random

@Serializable
enum class ConfirmPolicy {
    @SerialName("major") Major,
    @SerialName("important") Important,
    @SerialName("auto") Auto,
}

@Serializable
data class MirrorPreferences(
    val liveThinking: Boolean = true,
    val haptics: Boolean = true,
    val confirmPolicy: ConfirmPolicy = ConfirmPolicy.Important,
)

/** What the last failed action should tell the user; the screens word it. */
enum class MirrorError {
    NotConnected,
    Unknown,
}

/** The phone's whole view of the paired desktop. */
data class MirrorState(
    val ready: Boolean = false,
    val paired: Boolean = false,
    val desktop: StoredDesktop? = null,
    val link: LinkSnapshot = LinkSnapshot.Offline,
    val sessions: List<RemoteSessionSummary> = emptyList(),
    val sessionsLoaded: Boolean = false,
    /** The desktop's project list, the conversation bucket first; kept across launches. */
    val projects: List<RemoteProjectSummary> = emptyList(),
    /** Models each opened session may switch to, fetched on demand. */
    val models: Map<String, List<RemoteModelOption>> = emptyMap(),
    /** Models a new session may start with, kept across launches; see [DesktopMirror.loadNewSessionModels]. */
    val newSessionModels: List<RemoteModelOption> = emptyList(),
    /**
     * The model and level last used on this desktop, to start or switch a session;
     * New Session starts on it. Kept across launches.
     */
    val lastModelChoice: ModelChoice = ModelChoice(),
    val transcripts: Map<String, TranscriptState> = emptyMap(),
    /** Sessions opened by [DesktopMirror.startSession]: the local id the chat opened on → the desktop's id. */
    val startedSessions: Map<String, String> = emptyMap(),
    val startingSessions: Set<String> = emptySet(),
    val preferences: MirrorPreferences = MirrorPreferences(),
    val pairing: PairingPhase = PairingPhase.Idle,
    val lastError: MirrorError? = null,
) {
    val online: Boolean
        get() = link.isUsable

    val conversationCwd: String?
        get() = projects.firstOrNull { it.isConversation }?.cwd

    fun count(group: SessionStatusGroup): Int = sessions.count { SessionStatusGroup.of(it.status) == group }

    fun transcript(sessionId: String): TranscriptState = transcripts[sessionId] ?: TranscriptState.Empty

    fun session(sessionId: String): RemoteSessionSummary? = sessions.firstOrNull { it.id == sessionId }

    /** The desktop's id for a session started with [DesktopMirror.startSession], or `sessionId` itself. */
    fun resolve(sessionId: String): String = startedSessions[sessionId] ?: sessionId

    /** Whether the first prompt of a session started with [DesktopMirror.startSession] is still on its way. */
    fun isStarting(sessionId: String): Boolean = sessionId in startingSessions
}

/** What the mirror needs from the device; tests swap in memory stores and a fake desktop. */
class MirrorPlatform(
    val settings: Settings,
    val secrets: SecretStore,
    val cache: SessionCache,
    val createTransport: RemoteTransportFactory,
    val deviceName: String,
    val now: () -> Long,
    val onTurnEnd: () -> Unit = {},
    /** The phone identity an earlier build stored in its preferences. */
    val legacyIdentitySecret: String? = null,
    val configureLink: (DesktopLinkOptions) -> DesktopLinkOptions = { it },
    val configurePairing: (PairingFlowOptions) -> PairingFlowOptions = { it },
    val logger: RemoteLogger = NoopRemoteLogger,
    val createP2pTransport: P2pRemoteTransportFactory? = null,
)

/**
 * The phone's whole state for the paired desktop and every user action on it
 * (port of the iOS `AppModel.swift`). Owns the [DesktopLink]; screens read
 * [state] and call the actions.
 *
 * Everything runs on [scope], which must be confined to one thread (the main
 * thread in the app, the test dispatcher in tests): state is mutated without
 * locks, like the iOS main actor.
 */
class DesktopMirror(
    private val platform: MirrorPlatform,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(MirrorState())
    val state: StateFlow<MirrorState> = _state.asStateFlow()

    private val pairingStore = PairingStore(platform.settings, platform.secrets)
    private val reducer = TranscriptReducer(platform.now)
    private var deviceId = ""
    private var link: DesktopLink? = null
    private var linkJobs = emptyList<Job>()
    private var desktopKey: String? = null
    private var flow: PairingFlow? = null
    private val transcriptSaves = mutableMapOf<String, Job>()
    private var unsavedSequence: Pair<String, Long>? = null
    private var sequenceSave: Job? = null
    private var active = true
    private var newSessionModelsLoad: Deferred<Unit>? = null

    /** The link, for the few callers that speak the protocol directly. */
    val currentLink: DesktopLink?
        get() = link

    private inline fun mutate(block: (MirrorState) -> MirrorState) {
        _state.update(block)
    }

    // Lifecycle

    fun start() {
        if (_state.value.ready) return
        pairingStore.load(platform.legacyIdentitySecret)
        deviceId = platform.settings.getStringOrNull(DEVICE_ID_KEY)
            ?: "mobile-${RemoteCrypto.toBase64Url(RemoteCrypto.randomBytes(8))}".also { platform.settings[DEVICE_ID_KEY] = it }
        mutate { it.copy(preferences = decodePreferences(platform.settings.getStringOrNull(PREFERENCES_KEY))) }
        pairingStore.getCurrent()?.let(::attachLink)
        mutate { it.copy(ready = true) }
    }

    /** The app came to the foreground or went to the background. */
    fun setActive(value: Boolean) {
        val wasActive = active
        active = value
        if (!value) saveProgress()
        link?.setForeground(value)
        if (value && !wasActive) link?.refresh()
    }

    fun refreshLink() {
        link?.refresh()
    }

    /** The relay's screen-sharing viewer for the paired desktop, when it has a relay. */
    fun viewerUrl(): String? {
        val record = pairingStore.getCurrent() ?: return null
        val relay = record.relayBaseUrl ?: return null
        return desktopViewerUrl(relay, record.pairingId, record.mobileSecret)
    }

    // Pairing

    suspend fun pairWithCode(text: String): Boolean {
        val record = startFlow().pairWithCode(text) ?: return false
        finishPairing(record)
        return true
    }

    /** Pairs with the desktop at `host:port` on the local network, approved on the desktop. */
    suspend fun pairManually(endpoint: String): Boolean {
        val record = startFlow().pairManually(endpoint) ?: return false
        finishPairing(record)
        return true
    }

    fun cancelPairing() {
        flow?.cancel()
        flow = null
        mutate { it.copy(pairing = PairingPhase.Idle) }
    }

    fun unpair() {
        val key = desktopKey
        detachLink()
        if (key != null) {
            pairingStore.revoke(key)
            platform.cache.clearDesktop(key)
            platform.settings.remove(PROJECTS_KEY_PREFIX + key)
            platform.settings.remove(MODELS_KEY_PREFIX + key)
            platform.settings.remove(LAST_MODEL_KEY_PREFIX + key)
        }
        desktopKey = null
        mutate {
            it.copy(
                paired = false,
                desktop = null,
                sessions = emptyList(),
                sessionsLoaded = false,
                projects = emptyList(),
                models = emptyMap(),
                newSessionModels = emptyList(),
                lastModelChoice = ModelChoice(),
                transcripts = emptyMap(),
                link = LinkSnapshot.Offline,
            )
        }
    }

    private fun startFlow(): PairingFlow {
        flow?.cancel()
        val options =
            PairingFlowOptions(
                identity = pairingStore.getIdentity(),
                deviceId = deviceId,
                deviceName = platform.deviceName,
                createTransport = platform.createTransport,
                onPhase = { phase -> mutate { it.copy(pairing = phase) } },
                now = platform.now,
                logger = platform.logger,
            )
        return PairingFlow(platform.configurePairing(options), scope).also { flow = it }
    }

    private fun finishPairing(record: DesktopRecord) {
        pairingStore.save(record)
        attachLink(record)
        mutate { it.copy(pairing = PairingPhase.Idle) }
    }

    // Link

    private fun attachLink(record: DesktopRecord) {
        detachLink()
        val key = record.desktopIdentityKey
        desktopKey = key
        val cached = platform.cache.loadSessions(key)
        mutate {
            it.copy(
                paired = true,
                desktop = record.stored,
                sessions = cached,
                sessionsLoaded = cached.isNotEmpty(),
                projects = loadList(PROJECTS_KEY_PREFIX + key, RemoteProjectSummary.serializer()),
                models = emptyMap(),
                newSessionModels = loadList(MODELS_KEY_PREFIX + key, RemoteModelOption.serializer()),
                lastModelChoice =
                    platform.settings.getStringOrNull(LAST_MODEL_KEY_PREFIX + key)
                        ?.let { runCatching { json.decodeFromString(ModelChoice.serializer(), it) }.getOrNull() }
                        ?: ModelChoice(),
                transcripts = emptyMap(),
                link = LinkSnapshot.Offline,
            )
        }
        val options =
            DesktopLinkOptions(
                desktop = record,
                identity = pairingStore.getIdentity(),
                deviceId = deviceId,
                deviceName = platform.deviceName,
                createTransport = platform.createTransport,
                createP2pTransport = platform.createP2pTransport,
                p2pTarget = record.relayBaseUrl?.let { desktopViewerUrl(it, record.pairingId, record.mobileSecret) },
                now = platform.now,
                onSequence = { sequence -> keepSequence(key, sequence) },
                onLanEndpoints = { endpoints -> pairingStore.update(key) { it.copy(lanEndpoints = endpoints) } },
                logger = platform.logger,
            )
        val next = DesktopLink(platform.configureLink(options), scope)
        link = next
        linkJobs =
            listOf(
                scope.launch {
                    next.snapshot.collect { snapshot ->
                        val wasOnline = _state.value.link.isUsable
                        mutate { it.copy(link = snapshot) }
                        if (!wasOnline && snapshot.isUsable) scope.launch { refreshSessions() }
                    }
                },
                scope.launch { next.events.collect(::handleEvent) },
            )
        next.setForeground(active)
        next.start()
    }

    /**
     * Remembers the last event seen, for a relaunch to resume from. A streaming reply is
     * hundreds of events, and saving the pairing for each one kept the main thread busy
     * and made leaving the app wait for every write; it is saved at most every couple of
     * seconds, and at once when the app leaves the screen. A relaunch that resumes a little
     * early only sees a few events again, which are dropped as duplicates.
     */
    private fun keepSequence(key: String, sequence: Long) {
        unsavedSequence = key to sequence
        if (sequenceSave?.isActive == true) return
        sequenceSave =
            scope.launch {
                delay(SEQUENCE_SAVE_DELAY_MS)
                sequenceSave = null
                saveProgress()
            }
    }

    /** Saves where the phone got to in the desktop's events now, as the app leaves the screen. */
    fun saveProgress() {
        sequenceSave?.cancel()
        sequenceSave = null
        val (key, sequence) = unsavedSequence ?: return
        unsavedSequence = null
        pairingStore.update(key) { it.copy(lastEventSequence = sequence, lastSeenAt = platform.now()) }
    }

    private fun detachLink() {
        saveProgress()
        linkJobs.forEach(Job::cancel)
        linkJobs = emptyList()
        link?.stop()
        link = null
    }

    private fun requireLink(): DesktopLink = link ?: throw LinkOfflineException()

    private fun reportError(error: Throwable) {
        if (error is CancellationException) throw error
        platform.logger.warn("desktop action failed", mapOf("error" to error::class.simpleName))
        mutate { it.copy(lastError = if (error is LinkOfflineException) MirrorError.NotConnected else MirrorError.Unknown) }
    }

    // Events

    private fun dispatch(sessionId: String, action: TranscriptAction) {
        val next = reducer.reduce(_state.value.transcript(sessionId), action)
        mutate { it.copy(transcripts = it.transcripts + (sessionId to next)) }
        scheduleTranscriptSave(sessionId, next)
    }

    private fun scheduleTranscriptSave(sessionId: String, transcript: TranscriptState) {
        val key = desktopKey ?: return
        if (transcript.stale || !transcript.loaded) return
        transcriptSaves[sessionId]?.cancel()
        transcriptSaves[sessionId] =
            scope.launch {
                delay(TRANSCRIPT_SAVE_DELAY_MS)
                transcriptSaves.remove(sessionId)
                platform.cache.saveTranscript(key, sessionId, transcript.items)
            }
    }

    private fun patchSession(sessionId: String, patch: (RemoteSessionSummary) -> RemoteSessionSummary) {
        mutate { state -> state.copy(sessions = state.sessions.map { if (it.id == sessionId) patch(it) else it }) }
    }

    private fun handleEvent(event: RemoteEvent) {
        val sessionId = event.sessionId
        when (event.name) {
            RemoteEventName.SessionList -> keepSessions(RemoteApi.readSessionSummaries(event.payload))
            RemoteEventName.SessionState -> {
                if (sessionId == null) return
                dispatch(sessionId, TranscriptAction.State(RemoteApi.readSessionState(event.payload)))
                // The reducer keeps a pending question over a plain "running"; the list follows it.
                val status = _state.value.transcript(sessionId).sessionState.status
                patchSession(sessionId) { it.copy(status = status, updatedAt = platform.now()) }
            }
            RemoteEventName.SessionMessage -> {
                if (sessionId == null) return
                val message = RemoteApi.readMessageEvent(event.payload, platform.now) ?: return
                if (message is RemoteMessageEvent.ThinkingDelta && !_state.value.preferences.liveThinking) return
                dispatch(sessionId, TranscriptAction.Message(message))
                if (message is RemoteMessageEvent.TurnEnd && _state.value.preferences.haptics && active) platform.onTurnEnd()
                if (message is RemoteMessageEvent.User) patchSession(sessionId) { it.copy(preview = message.text, updatedAt = message.at) }
            }
            RemoteEventName.SessionTool -> {
                if (sessionId == null) return
                val tool = RemoteApi.readToolEvent(event.payload) ?: return
                dispatch(sessionId, TranscriptAction.Tool(tool))
            }
            RemoteEventName.SessionInput -> {
                if (sessionId == null) return
                val payload = event.payload as? JsonObject ?: return
                when (payload.string("kind")) {
                    "question" -> {
                        val request = RemoteApi.readQuestionRequest(payload["request"]) ?: return
                        dispatch(sessionId, TranscriptAction.Question(request))
                        patchSession(sessionId) { it.copy(status = RemoteSessionStatus.WaitingInput, updatedAt = platform.now()) }
                    }
                    "resolved" -> {
                        val requestId = payload.string("requestId") ?: return
                        dispatch(sessionId, TranscriptAction.QuestionResolved(requestId))
                    }
                }
            }
            RemoteEventName.SessionResync -> {
                mutate { state -> state.copy(transcripts = state.transcripts.mapValues { (_, value) -> reducer.reduce(value, TranscriptAction.Resync) }) }
                scope.launch { refreshSessions() }
            }
            else -> Unit
        }
    }

    // Actions

    suspend fun refreshSessions() {
        try {
            val result = requireLink().request(RemoteRequestMethod.SessionList, buildJsonObject { put("limit", SESSION_LIST_LIMIT) })
            val list = RemoteApi.readSessionSummaries(result)
            keepSessions(list)
            // Ready before New Session opens. Only when it is cheap or there is nothing yet:
            // borrowing a session that is not open makes the desktop load it.
            if (_state.value.newSessionModels.isEmpty() || list.any { it.live }) scope.launch { loadNewSessionModels() }
            refreshProjects()
        } catch (_: LinkOfflineException) {
            // Offline: what was loaded or cached stays on screen.
        } catch (error: Throwable) {
            reportError(error)
        }
    }

    suspend fun refreshProjects() {
        try {
            val list = RemoteApi.readProjectSummaries(requireLink().request(RemoteRequestMethod.ProjectList))
            if (list.isEmpty()) return
            mutate { it.copy(projects = list) }
            desktopKey?.let { saveList(PROJECTS_KEY_PREFIX + it, RemoteProjectSummary.serializer(), list) }
        } catch (_: LinkOfflineException) {
            // Offline: what was loaded or cached stays on screen.
        } catch (error: Throwable) {
            reportError(error)
        }
    }

    suspend fun openSession(sessionId: String) {
        val key = desktopKey
        if (_state.value.transcripts[sessionId] == null && key != null) {
            platform.cache.loadTranscript(key, sessionId)?.let { cached ->
                val restored = TranscriptState.Empty.copy(items = cached, loaded = true, stale = true)
                mutate { it.copy(transcripts = it.transcripts + (sessionId to restored)) }
            }
        }
        try {
            val current = requireLink()
            val opened = current.request(RemoteRequestMethod.SessionOpen, sessionId = sessionId)
            val history = current.request(RemoteRequestMethod.SessionHistory, sessionId = sessionId)
            val entries = RemoteApi.readTranscriptEntries(history)
            val sessionState = RemoteApi.readSessionState((history as? JsonObject)?.get("state") ?: (opened as? JsonObject)?.get("state"))
            dispatch(sessionId, TranscriptAction.History(entries, sessionState))
            patchSession(sessionId) { it.copy(status = sessionState.status, live = true) }
        } catch (_: LinkOfflineException) {
            // Offline: what was loaded or cached stays on screen.
        } catch (error: Throwable) {
            reportError(error)
        }
    }

    suspend fun loadModels(sessionId: String) {
        try {
            val options = RemoteApi.readModelOptions(requireLink().request(RemoteRequestMethod.ModelList, sessionId = sessionId))
            mutate { it.copy(models = it.models + (sessionId to options)) }
            // Every session reads the same registry, so any list also serves New Session.
            if (options.isNotEmpty()) keepNewSessionModels(options)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            // An older desktop does not know `model.list`; the title then just shows the model.
            platform.logger.info("model.list unavailable", mapOf("error" to error::class.simpleName))
        }
    }

    /**
     * The desktop lists models per session and every session reads the same
     * registry, so a new session borrows another one's list. A session the desktop
     * already has open answers at once; any other one is loaded from disk first,
     * which takes seconds, so an open one is preferred and the last list is kept
     * for the next launch. Concurrent calls share one request.
     */
    suspend fun loadNewSessionModels() {
        newSessionModelsLoad?.let { return it.await() }
        val load =
            scope.async {
                val sessions = _state.value.sessions
                val donor = sessions.filter { it.live }.maxByOrNull { it.updatedAt } ?: sessions.maxByOrNull { it.updatedAt }
                if (donor != null) loadModels(donor.id)
            }
        newSessionModelsLoad = load
        try {
            load.await()
        } finally {
            if (newSessionModelsLoad === load) newSessionModelsLoad = null
        }
    }

    private fun keepNewSessionModels(options: List<RemoteModelOption>) {
        if (options == _state.value.newSessionModels) return
        mutate { it.copy(newSessionModels = options) }
        desktopKey?.let { saveList(MODELS_KEY_PREFIX + it, RemoteModelOption.serializer(), options) }
    }

    private fun rememberModel(choice: ModelChoice) {
        if (choice == _state.value.lastModelChoice) return
        mutate { it.copy(lastModelChoice = choice) }
        desktopKey?.let { platform.settings[LAST_MODEL_KEY_PREFIX + it] = json.encodeToString(ModelChoice.serializer(), choice) }
    }

    /**
     * Switches the session's model and/or thinking level on the desktop, and remembers
     * where it landed for the next New Session.
     */
    suspend fun configure(sessionId: String, modelKey: String? = null, thinkingLevel: String? = null): Boolean {
        if (modelKey == null && thinkingLevel == null) return false
        val payload =
            buildJsonObject {
                modelKey?.let { put("modelKey", it) }
                thinkingLevel?.let { put("thinkingLevel", it) }
            }
        return try {
            val result = requireLink().request(RemoteRequestMethod.SessionConfigure, payload, sessionId)
            val state = RemoteApi.readSessionState((result as? JsonObject)?.get("state"))
            dispatch(sessionId, TranscriptAction.State(state))
            rememberModel(ModelChoice(state.modelKey ?: modelKey, state.thinkingLevel ?: thinkingLevel))
            true
        } catch (error: Throwable) {
            reportError(error)
            false
        }
    }

    /**
     * Sends a prompt; with no session a new one is created first, in `projectCwd`
     * or, without one, in the desktop's conversations. Attachments are uploaded one
     * per request first. Returns the session that received it, or null when nothing was sent.
     */
    suspend fun sendPrompt(
        sessionId: String?,
        text: String,
        projectCwd: String? = null,
        modelKey: String? = null,
        thinkingLevel: String? = null,
        attachments: List<PromptAttachment> = emptyList(),
    ): String? {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return null
        return try {
            if (sessionId == null) rememberModel(ModelChoice(modelKey, thinkingLevel))
            val target =
                sessionId ?: createSession(projectCwd).also { created ->
                    // A failed switch is reported; the prompt still goes out on the default model.
                    configure(created, modelKey, thinkingLevel)
                }
            deliver(target, trimmed, attachments, echo = true)
            target
        } catch (error: Throwable) {
            reportError(error)
            null
        }
    }

    /**
     * Starts a session without waiting on the desktop. The chat opens on the
     * returned local id with the prompt already in it, while the session is
     * created, switched to `modelKey` and `thinkingLevel` and sent the attachments
     * and the prompt in the background; [MirrorState.resolve] then maps the local id
     * to the desktop's. `onFailure` runs when the prompt did not go out. Null when
     * there is no text.
     */
    fun startSession(
        text: String,
        projectCwd: String? = null,
        modelKey: String? = null,
        thinkingLevel: String? = null,
        attachments: List<PromptAttachment> = emptyList(),
        onFailure: () -> Unit = {},
    ): String? {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return null
        val localId = "local-session-${Random.nextLong().toULong().toString(36)}"
        // Assigned rather than dispatched: a local id has nothing to cache.
        var transcript = reducer.reduce(TranscriptState.Empty, TranscriptAction.History(emptyList(), RemoteSessionState(RemoteSessionStatus.Running)))
        transcript = reducer.reduce(transcript, TranscriptAction.LocalUser(trimmed, platform.now(), attachments.map { it.toTranscript() }))
        mutate { it.copy(transcripts = it.transcripts + (localId to transcript), startingSessions = it.startingSessions + localId) }
        rememberModel(ModelChoice(modelKey, thinkingLevel))
        scope.launch {
            try {
                val target = createSession(projectCwd)
                // Hand the chat over before anything is sent, so the desktop's events land in it.
                mutate { state ->
                    val moved = state.transcripts[localId]
                    state.copy(
                        transcripts = (state.transcripts - localId).let { if (moved != null) it + (target to moved) else it },
                        startedSessions = state.startedSessions + (localId to target),
                    )
                }
                configure(target, modelKey, thinkingLevel)
                deliver(target, trimmed, attachments, echo = false)
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                mutate { it.copy(transcripts = it.transcripts - localId) }
                reportError(error)
                onFailure()
            } finally {
                mutate { it.copy(startingSessions = it.startingSessions - localId) }
            }
        }
        return localId
    }

    private suspend fun createSession(projectCwd: String?): String {
        val payload = projectCwd?.let { buildJsonObject { put("projectCwd", it) } }
        val created = requireLink().request(RemoteRequestMethod.SessionCreate, payload)
        val session =
            RemoteApi.readSessionSummary((created as? JsonObject)?.get("session"))
                ?: throw IllegalStateException("session.create returned no session")
        mutate { state -> state.copy(sessions = listOf(session) + state.sessions.filterNot { it.id == session.id }) }
        dispatch(session.id, TranscriptAction.History(emptyList(), RemoteSessionState(RemoteSessionStatus.Idle)))
        return session.id
    }

    /** Uploads the attachments, then sends the prompt; `echo` shows it in the chat first. */
    private suspend fun deliver(target: String, text: String, attachments: List<PromptAttachment>, echo: Boolean) {
        val current = requireLink()
        val uploadIds =
            attachments.map { attachment ->
                val uploaded = current.request(RemoteRequestMethod.SessionUpload, attachment.toJson(), target)
                (uploaded as? JsonObject)?.string("uploadId") ?: throw IllegalStateException("session.upload returned no uploadId")
            }
        val now = platform.now()
        if (echo) dispatch(target, TranscriptAction.LocalUser(text, now, attachments.map { it.toTranscript() }))
        dispatch(target, TranscriptAction.State(RemoteSessionState(RemoteSessionStatus.Running)))
        val title = currentTitle(target, fallback = text)
        patchSession(target) { it.copy(status = RemoteSessionStatus.Running, preview = text, updatedAt = now, title = title) }
        val payload =
            buildJsonObject {
                put("text", text)
                if (uploadIds.isNotEmpty()) put("attachments", JsonArray(uploadIds.map(::JsonPrimitive)))
            }
        current.request(RemoteRequestMethod.SessionPrompt, payload, target)
    }

    suspend fun respond(sessionId: String, requestId: String, answers: List<RemoteQuestionAnswer>, cancelled: Boolean = false) {
        try {
            val payload =
                buildJsonObject {
                    put("requestId", requestId)
                    put("cancelled", cancelled)
                    put("answers", JsonArray(answers.map { it.toJson() }))
                }
            requireLink().request(RemoteRequestMethod.SessionRespond, payload, sessionId)
            dispatch(sessionId, TranscriptAction.QuestionResolved(requestId))
            patchSession(sessionId) { it.copy(status = RemoteSessionStatus.Running) }
        } catch (error: Throwable) {
            reportError(error)
        }
    }

    suspend fun abort(sessionId: String) {
        try {
            requireLink().request(RemoteRequestMethod.SessionAbort, sessionId = sessionId)
        } catch (error: Throwable) {
            reportError(error)
        }
    }

    suspend fun resync(sessionId: String) {
        dispatch(sessionId, TranscriptAction.Resync)
        openSession(sessionId)
        refreshSessions()
    }

    /** Renames the session on the desktop; the sidebar there shows the new title too. */
    suspend fun rename(sessionId: String, title: String): Boolean {
        val trimmed = title.trim()
        if (trimmed.isEmpty()) return false
        return try {
            val result = requireLink().request(RemoteRequestMethod.SessionRename, buildJsonObject { put("title", trimmed) }, sessionId)
            adopt((result as? JsonObject)?.get("session"))
            true
        } catch (error: Throwable) {
            reportError(error)
            false
        }
    }

    /**
     * Pins or unpins the session, the same pin as the desktop sidebar's. The list
     * moves at once; the desktop's pin time replaces the phone's when it answers.
     */
    suspend fun setPinned(sessionId: String, pinned: Boolean): Boolean {
        val before = _state.value.session(sessionId)?.pinnedAt
        patchSession(sessionId) { it.copy(pinnedAt = if (pinned) platform.now() else null) }
        return try {
            val result = requireLink().request(RemoteRequestMethod.SessionPin, buildJsonObject { put("pinned", pinned) }, sessionId)
            adopt((result as? JsonObject)?.get("session"))
            true
        } catch (error: Throwable) {
            patchSession(sessionId) { it.copy(pinnedAt = before) }
            reportError(error)
            false
        }
    }

    /** Deletes the session on the desktop, and with it everything kept here. */
    suspend fun deleteSession(sessionId: String): Boolean =
        try {
            requireLink().request(RemoteRequestMethod.SessionDelete, sessionId = sessionId)
            mutate {
                it.copy(
                    sessions = it.sessions.filterNot { session -> session.id == sessionId },
                    transcripts = it.transcripts - sessionId,
                    models = it.models - sessionId,
                )
            }
            // Saving the list without it drops its cached transcript too.
            desktopKey?.let { platform.cache.saveSessions(it, _state.value.sessions) }
            true
        } catch (error: Throwable) {
            reportError(error)
            false
        }

    /** Takes the title and pin from a summary the desktop just returned; the status stays as the live events left it. */
    private fun adopt(value: JsonElement?) {
        val summary = RemoteApi.readSessionSummary(value) ?: return
        patchSession(summary.id) { it.copy(title = summary.title, pinnedAt = summary.pinnedAt) }
        desktopKey?.let { platform.cache.saveSessions(it, _state.value.sessions) }
    }

    private fun keepSessions(list: List<RemoteSessionSummary>) {
        mutate { it.copy(sessions = list, sessionsLoaded = true) }
        desktopKey?.let { platform.cache.saveSessions(it, list) }
    }

    fun setPreferences(update: (MirrorPreferences) -> MirrorPreferences) {
        val next = update(_state.value.preferences)
        mutate { it.copy(preferences = next) }
        platform.settings[PREFERENCES_KEY] = json.encodeToString(MirrorPreferences.serializer(), next)
    }

    fun clearError() {
        mutate { it.copy(lastError = null) }
    }

    private fun currentTitle(sessionId: String, fallback: String): String =
        _state.value.session(sessionId)?.title?.takeIf { it.isNotBlank() } ?: fallback.take(TITLE_FALLBACK_LENGTH)

    private fun <T> loadList(key: String, serializer: kotlinx.serialization.KSerializer<T>): List<T> =
        platform.settings.getStringOrNull(key)?.let { runCatching { json.decodeFromString(ListSerializer(serializer), it) }.getOrNull() }.orEmpty()

    private fun <T> saveList(key: String, serializer: kotlinx.serialization.KSerializer<T>, list: List<T>) {
        platform.settings[key] = json.encodeToString(ListSerializer(serializer), list)
    }

    companion object {
        const val PREFERENCES_KEY = "vetta.preferences"
        const val DEVICE_ID_KEY = "vetta.device.id"
        const val PROJECTS_KEY_PREFIX = "vetta.projects."
        const val MODELS_KEY_PREFIX = "vetta.models."
        const val LAST_MODEL_KEY_PREFIX = "vetta.lastModel."

        private const val SESSION_LIST_LIMIT = 200
        private const val TRANSCRIPT_SAVE_DELAY_MS = 400L
        private const val SEQUENCE_SAVE_DELAY_MS = 2_000L
        private const val TITLE_FALLBACK_LENGTH = 60
        private val json = Json { ignoreUnknownKeys = true }

        private fun decodePreferences(raw: String?): MirrorPreferences =
            raw?.let { runCatching { json.decodeFromString(MirrorPreferences.serializer(), it) }.getOrNull() } ?: MirrorPreferences()

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.jsonPrimitive?.content
    }
}
