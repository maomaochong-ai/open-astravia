package org.vetta.android.domain.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put

/*
 * Payload contracts carried inside requests, responses and events (port of the
 * iOS `RemoteAPI.swift`, itself a port of `packages/remote-control/src/api.ts`).
 * Readers are tolerant: unknown fields are dropped and malformed entries skipped.
 */

@Serializable
enum class RemoteSessionStatus {
    @SerialName("idle") Idle,
    @SerialName("running") Running,
    @SerialName("thinking") Thinking,
    @SerialName("waiting_input") WaitingInput,
    @SerialName("completed") Completed,
    @SerialName("error") Error,
    @SerialName("aborted") Aborted,
    ;

    val isActive: Boolean
        get() = this == Running || this == Thinking || this == WaitingInput

    companion object {
        fun parse(value: String?): RemoteSessionStatus =
            when (value) {
                "running" -> Running
                "thinking" -> Thinking
                "waiting_input" -> WaitingInput
                "completed" -> Completed
                "error" -> Error
                "aborted" -> Aborted
                else -> Idle
            }
    }
}

@Serializable
data class RemoteProjectSummary(
    val cwd: String,
    val name: String,
    /** "conversation" for the desktop's project-less chats, otherwise "project". */
    val kind: String,
    val sessionCount: Int,
) {
    val isConversation: Boolean
        get() = kind == "conversation"
}

@Serializable
data class RemoteSessionSummary(
    val id: String,
    val projectCwd: String,
    val projectName: String,
    val title: String,
    val preview: String? = null,
    val updatedAt: Long,
    val status: RemoteSessionStatus,
    /** True when the desktop currently holds a live runtime instance for it. */
    val live: Boolean,
    /** Set while pinned, shared with the desktop sidebar; newer pins sort first. */
    val pinnedAt: Long? = null,
) {
    val pinned: Boolean
        get() = pinnedAt != null
}

@Serializable
data class RemoteQuestionOption(val label: String, val description: String)

@Serializable
data class RemoteQuestionItem(
    val question: String,
    val header: String,
    val options: List<RemoteQuestionOption>,
    val multiSelect: Boolean,
)

@Serializable
data class RemoteQuestionRequest(val requestId: String, val questions: List<RemoteQuestionItem>)

data class RemoteQuestionAnswer(val question: String, val answers: List<String>) {
    fun toJson(): JsonObject =
        buildJsonObject {
            put("question", question)
            put("answers", buildJsonArray { answers.forEach { add(JsonPrimitive(it)) } })
        }
}

/** What a `session.upload` carries: a picture the desktop can look at, or any other file. */
@Serializable
enum class AttachmentKind(val wire: String) {
    @SerialName("image") Image("image"),
    @SerialName("file") File("file"),
}

@Serializable
data class RemoteSessionError(val code: String, val message: String)

@Serializable
data class RemoteSessionState(
    val status: RemoteSessionStatus,
    val detail: String? = null,
    /** Display name of the session's model. */
    val model: String? = null,
    /** `provider/modelId`, as `session.configure` takes it. */
    val modelKey: String? = null,
    val thinkingLevel: String? = null,
    val contextPercent: Double? = null,
    val error: RemoteSessionError? = null,
    /** Present while the desktop waits for an answer that the phone may give. */
    val pendingQuestion: RemoteQuestionRequest? = null,
)

/** A model the session can switch to, with the thinking levels it accepts. */
@Serializable
data class RemoteModelOption(
    /** `provider/modelId`. */
    val key: String,
    val name: String,
    val provider: String,
    /** Empty when the model has no thinking control; otherwise starts with "off" or "none". */
    val thinkingLevels: List<String>,
    val defaultThinkingLevel: String? = null,
    val supportsImage: Boolean,
)

enum class RemoteToolPhase {
    Generating,
    Started,
    Updated,
    Phase,
    Completed,
    Failed,
    ;

    companion object {
        fun parse(value: String?): RemoteToolPhase? =
            when (value) {
                "generating" -> Generating
                "started" -> Started
                "updated" -> Updated
                "phase" -> Phase
                "completed" -> Completed
                "failed" -> Failed
                else -> null
            }
    }
}

data class RemoteToolEvent(
    val toolCallId: String,
    val toolName: String,
    val phase: RemoteToolPhase,
    val args: String? = null,
    val result: String? = null,
    val label: String? = null,
    val durationMs: Double? = null,
)

sealed interface RemoteMessageEvent {
    data class User(val text: String, val at: Long) : RemoteMessageEvent

    data class AssistantDelta(val text: String) : RemoteMessageEvent

    data class ThinkingDelta(val text: String) : RemoteMessageEvent

    data class TurnEnd(val at: Long) : RemoteMessageEvent
}

data class RemoteToolCallSummary(
    val toolCallId: String,
    val toolName: String,
    val args: String? = null,
    val result: String? = null,
    val isError: Boolean = false,
    val durationMs: Double? = null,
)

sealed interface RemoteTranscriptEntry {
    val id: String

    data class User(override val id: String, val text: String, val at: Long?) : RemoteTranscriptEntry

    data class Assistant(
        override val id: String,
        val text: String,
        val thinking: String?,
        val toolCalls: List<RemoteToolCallSummary>,
        val at: Long?,
        val error: String?,
    ) : RemoteTranscriptEntry

    data class Marker(override val id: String, val text: String, val at: Long?) : RemoteTranscriptEntry
}

data class RemoteDeviceStatus(
    val deviceName: String,
    val osLabel: String?,
    val lanEndpoints: List<String>,
    val relayEnabled: Boolean,
    val runningSessionCount: Int,
    /** Whether this phone may view and operate the desktop's screen; null from desktops that let every phone view. */
    val desktopControl: Boolean? = null,
    /** The relay the desktop uses now; a phone paired with another one follows it. Null when away access is off, or from older desktops. */
    val relayBaseUrl: String? = null,
    /**
     * Whether the desktop answers `screen.subscribe` and captures only while it is open
     * (ADR-0140); older desktops share the screen whenever the P2P link is up.
     */
    val screen: Boolean = false,
    /** Whether the desktop answers `file.list`, `file.stat` and `file.read` (ADR-0139). */
    val fileRead: Boolean = false,
)

/**
 * A file or folder the phone may look at, as `file.list` and `file.stat` describe it.
 * `path` is the desktop's canonical form and what the phone passes back; the phone never
 * builds paths itself (ADR-0139).
 */
data class RemoteFileEntry(
    val name: String,
    val path: String,
    val isDirectory: Boolean,
    val size: Long,
    /** Milliseconds since the epoch. */
    val modifiedAt: Double,
)

data class RemoteFileInfo(
    val name: String,
    val path: String,
    val isDirectory: Boolean,
    val size: Long,
    val modifiedAt: Double,
    /** Guessed from the extension; a chunk's type says what was actually sent (scaled images arrive as JPEG). */
    val mimeType: String,
    /** The home directory abbreviated to `~`, for showing where the file lives. */
    val displayPath: String,
)

/** One chunk of `file.read`. */
class RemoteFileChunk(val data: ByteArray, val offset: Long, val totalSize: Long, val modifiedAt: Double, val mimeType: String)

/**
 * A skill or scene the phone may reference by writing `@skill:<name>` / `@scene:<name>`
 * into a prompt, already filtered and ordered as the desktop composer's picker shows them
 * (ADR-0137).
 */
data class RemoteSkillOption(
    /** What the token carries; the agent looks the skill up by it. */
    val name: String,
    /** Display name; null when it equals [name]. */
    val alias: String?,
    val description: String,
    val kind: Kind,
    /** Where it was installed: `builtin`, `plugin`, `user`, `project`, `market`… */
    val source: String,
) {
    enum class Kind(val wire: String) {
        Skill("skill"),
        Scene("scene"),
    }

    val id: String
        get() = "${kind.wire}:$name"

    val displayName: String
        get() = alias ?: name
}

/**
 * The pointer as the desktop shows it now (arrow, I-beam, hand…), for a phone that draws
 * the pointer itself where its finger put it. Sizes are in the desktop's points;
 * `screenWidth` is its display's, to scale the pointer with the picture.
 */
class RemoteScreenCursor(
    /** PNG. */
    val image: ByteArray,
    val width: Float,
    val height: Float,
    /** The point of the image that is the pointer's position, from its top-left. */
    val hotspotX: Float,
    val hotspotY: Float,
    val screenWidth: Float,
) {
    /**
     * How much to scale the desktop's pointer when its screen is shown `shownWidth` wide:
     * its height stays between [MIN_SHOWN_HEIGHT] and [MAX_SHOWN_HEIGHT] dp however small the
     * picture is or however far it is zoomed, readable and never in the way.
     */
    fun scale(shownWidth: Float): Float = (height * shownWidth / screenWidth).coerceIn(MIN_SHOWN_HEIGHT, MAX_SHOWN_HEIGHT) / height

    companion object {
        const val MIN_SHOWN_HEIGHT = 18f
        const val MAX_SHOWN_HEIGHT = 30f
    }
}

/** Why frames or taps might not reach the phone, from `screen.subscribe` and `screen.status`. */
enum class RemoteScreenState {
    Stopped,
    Streaming,

    /** macOS withholds Screen Recording: the phone explains it instead of showing black. */
    PermissionDenied,
    Unavailable,
}

enum class RemoteInputState {
    Ready,

    /** macOS withholds Accessibility: the picture shows, taps and keys do nothing. */
    PermissionDenied,
    Unsupported,
}

data class RemoteScreenStatus(val screen: RemoteScreenState, val input: RemoteInputState)

/** Sealed follow-up to a manual pairing approval; carries the long-lived credential. */
data class RemoteDevicePaired(
    val pairingId: String,
    val mobileSecret: String,
    val desktopName: String,
    val lanEndpoints: List<String>,
    val relayBaseUrl: String?,
)

object RemoteApi {
    /**
     * Largest attachment one `session.upload` may carry, before base64: one
     * sealed frame holds ~1 MB of JSON, so attachments travel one per request.
     */
    const val MAX_UPLOAD_BYTES = 700 * 1024

    fun readSessionSummary(value: JsonElement?): RemoteSessionSummary? {
        val obj = value as? JsonObject ?: return null
        val id = obj.text("id") ?: return null
        val projectCwd = obj.text("projectCwd") ?: return null
        return RemoteSessionSummary(
            id = id,
            projectCwd = projectCwd,
            projectName = obj.string("projectName") ?: projectCwd,
            title = obj.string("title").orEmpty(),
            preview = obj.string("preview"),
            updatedAt = obj.long("updatedAt") ?: 0,
            status = RemoteSessionStatus.parse(obj.string("status")),
            live = obj.bool("live") == true,
            pinnedAt = obj.long("pinnedAt"),
        )
    }

    fun readSessionSummaries(value: JsonElement?): List<RemoteSessionSummary> =
        (value as? JsonObject).array("sessions").mapNotNull(::readSessionSummary)

    fun readQuestionRequest(value: JsonElement?): RemoteQuestionRequest? {
        val obj = value as? JsonObject ?: return null
        val requestId = obj.text("requestId") ?: return null
        val list = obj["questions"] as? JsonArray ?: return null
        val questions =
            list.mapNotNull { item ->
                val question = item as? JsonObject ?: return@mapNotNull null
                val text = question.text("question") ?: return@mapNotNull null
                val options =
                    question.array("options").mapNotNull { option ->
                        val entry = option as? JsonObject ?: return@mapNotNull null
                        val label = entry.text("label") ?: return@mapNotNull null
                        RemoteQuestionOption(label, entry.string("description").orEmpty())
                    }
                RemoteQuestionItem(
                    question = text,
                    header = question.string("header").orEmpty(),
                    options = options,
                    multiSelect = question.bool("multiSelect") == true,
                )
            }
        return RemoteQuestionRequest(requestId, questions)
    }

    fun readSessionState(value: JsonElement?): RemoteSessionState {
        val obj = value as? JsonObject ?: return RemoteSessionState(RemoteSessionStatus.Idle)
        val error =
            (obj["error"] as? JsonObject)?.let {
                RemoteSessionError(code = it.string("code") ?: "internal_error", message = it.string("message").orEmpty())
            }
        return RemoteSessionState(
            status = RemoteSessionStatus.parse(obj.string("status")),
            detail = obj.string("detail"),
            model = obj.string("model"),
            modelKey = obj.string("modelKey"),
            thinkingLevel = obj.string("thinkingLevel"),
            contextPercent = obj.double("contextPercent"),
            error = error,
            pendingQuestion = readQuestionRequest(obj["pendingQuestion"]),
        )
    }

    fun readToolEvent(value: JsonElement?): RemoteToolEvent? {
        val obj = value as? JsonObject ?: return null
        return RemoteToolEvent(
            toolCallId = obj.text("toolCallId") ?: return null,
            toolName = obj.text("toolName") ?: return null,
            phase = RemoteToolPhase.parse(obj.string("phase")) ?: return null,
            args = obj.string("args"),
            result = obj.string("result"),
            label = obj.string("label"),
            durationMs = obj.double("durationMs"),
        )
    }

    fun readMessageEvent(value: JsonElement?, now: () -> Long): RemoteMessageEvent? {
        val obj = value as? JsonObject ?: return null
        return when (obj.string("kind")) {
            "user" -> RemoteMessageEvent.User(obj.string("text") ?: return null, obj.long("at") ?: now())
            "assistant_delta" -> obj.string("text")?.let(RemoteMessageEvent::AssistantDelta)
            "thinking_delta" -> obj.string("text")?.let(RemoteMessageEvent::ThinkingDelta)
            "turn_end" -> RemoteMessageEvent.TurnEnd(obj.long("at") ?: now())
            else -> null
        }
    }

    fun readTranscriptEntries(value: JsonElement?): List<RemoteTranscriptEntry> =
        (value as? JsonObject).array("entries").mapNotNull { element ->
            val entry = element as? JsonObject ?: return@mapNotNull null
            val id = entry.text("id") ?: return@mapNotNull null
            when (entry.string("kind")) {
                "user" -> RemoteTranscriptEntry.User(id, entry.string("text").orEmpty(), entry.long("at"))
                "assistant" ->
                    RemoteTranscriptEntry.Assistant(
                        id = id,
                        text = entry.string("text").orEmpty(),
                        thinking = entry.string("thinking"),
                        toolCalls =
                            entry.array("toolCalls").mapNotNull { element ->
                                val call = element as? JsonObject ?: return@mapNotNull null
                                RemoteToolCallSummary(
                                    toolCallId = call.text("toolCallId") ?: return@mapNotNull null,
                                    toolName = call.text("toolName") ?: return@mapNotNull null,
                                    args = call.string("args"),
                                    result = call.string("result"),
                                    isError = call.bool("isError") == true,
                                    durationMs = call.double("durationMs"),
                                )
                            },
                        at = entry.long("at"),
                        error = entry.string("error"),
                    )
                "marker" -> RemoteTranscriptEntry.Marker(id, entry.string("text").orEmpty(), entry.long("at"))
                else -> null
            }
        }

    fun readDeviceStatus(value: JsonElement?): RemoteDeviceStatus? {
        val obj = value as? JsonObject ?: return null
        return RemoteDeviceStatus(
            deviceName = obj.text("deviceName") ?: return null,
            osLabel = obj.string("osLabel"),
            lanEndpoints = obj.array("lanEndpoints").mapNotNull { (it as? JsonPrimitive)?.takeIf(JsonPrimitive::isString)?.content },
            relayEnabled = obj.bool("relayEnabled") == true,
            runningSessionCount = obj.double("runningSessionCount")?.toInt() ?: 0,
            desktopControl = obj.bool("desktopControl"),
            relayBaseUrl = normalizeRelayBaseUrl(obj.string("relayBaseUrl")),
            screen = obj.bool("screen") == true,
            fileRead = obj.bool("fileRead") == true,
        )
    }

    /** A state from a newer desktop reads as unavailable or unsupported. */
    private fun readFileEntry(value: JsonElement?): RemoteFileEntry? {
        val obj = value as? JsonObject ?: return null
        val name = obj.text("name") ?: return null
        val path = obj.string("path") ?: return null
        return RemoteFileEntry(name, path, obj.bool("isDirectory") == true, obj.double("size")?.toLong() ?: 0, obj.double("modifiedAt") ?: 0.0)
    }

    fun readFileEntries(value: JsonElement?): List<RemoteFileEntry> =
        ((value as? JsonObject)?.get("entries") as? JsonArray).orEmpty().mapNotNull(::readFileEntry)

    fun readFileInfo(value: JsonElement?): RemoteFileInfo? {
        val file = (value as? JsonObject)?.get("file") as? JsonObject ?: return null
        val entry = readFileEntry(file) ?: return null
        return RemoteFileInfo(
            name = entry.name,
            path = entry.path,
            isDirectory = entry.isDirectory,
            size = entry.size,
            modifiedAt = entry.modifiedAt,
            mimeType = file.string("mimeType") ?: "application/octet-stream",
            displayPath = file.string("displayPath") ?: entry.path,
        )
    }

    fun readFileChunk(value: JsonElement?): RemoteFileChunk? {
        val obj = value as? JsonObject ?: return null
        val data = obj.string("data")?.let { runCatching { java.util.Base64.getDecoder().decode(it) }.getOrNull() } ?: return null
        val offset = obj.double("offset")?.toLong() ?: return null
        val totalSize = obj.double("totalSize")?.toLong() ?: return null
        return RemoteFileChunk(data, offset, totalSize, obj.double("modifiedAt") ?: 0.0, obj.string("mimeType") ?: "application/octet-stream")
    }

    fun readSkillOptions(value: JsonElement?): List<RemoteSkillOption> =
        ((value as? JsonObject)?.get("skills") as? JsonArray).orEmpty().mapNotNull { entry ->
            val obj = entry as? JsonObject ?: return@mapNotNull null
            val name = obj.text("name") ?: return@mapNotNull null
            val kind = RemoteSkillOption.Kind.entries.firstOrNull { it.wire == obj.string("type") } ?: return@mapNotNull null
            RemoteSkillOption(
                name = name,
                alias = obj.text("alias")?.takeIf { it != name },
                description = obj.string("description").orEmpty(),
                kind = kind,
                source = obj.string("source").orEmpty(),
            )
        }

    fun readScreenCursor(value: JsonElement?): RemoteScreenCursor? {
        val obj = value as? JsonObject ?: return null
        val image = obj.string("image")?.let { runCatching { java.util.Base64.getDecoder().decode(it) }.getOrNull() } ?: return null
        val width = obj.double("width")?.toFloat()?.takeIf { it > 0f } ?: return null
        val height = obj.double("height")?.toFloat()?.takeIf { it > 0f } ?: return null
        val screenWidth = obj.double("screenWidth")?.toFloat()?.takeIf { it > 0f } ?: return null
        return RemoteScreenCursor(
            image = image,
            width = width,
            height = height,
            hotspotX = (obj.double("hotspotX")?.toFloat() ?: 0f).coerceIn(0f, width),
            hotspotY = (obj.double("hotspotY")?.toFloat() ?: 0f).coerceIn(0f, height),
            screenWidth = screenWidth,
        )
    }

    fun readScreenStatus(value: JsonElement?): RemoteScreenStatus? {
        val obj = value as? JsonObject ?: return null
        val screen = obj.string("screen") ?: return null
        val input = obj.string("input") ?: return null
        return RemoteScreenStatus(
            screen =
                when (screen) {
                    "stopped" -> RemoteScreenState.Stopped
                    "streaming" -> RemoteScreenState.Streaming
                    "permission_denied" -> RemoteScreenState.PermissionDenied
                    else -> RemoteScreenState.Unavailable
                },
            input =
                when (input) {
                    "ready" -> RemoteInputState.Ready
                    "permission_denied" -> RemoteInputState.PermissionDenied
                    else -> RemoteInputState.Unsupported
                },
        )
    }

    fun readDevicePaired(value: JsonElement?): RemoteDevicePaired? {
        val obj = value as? JsonObject ?: return null
        return RemoteDevicePaired(
            pairingId = obj.text("pairingId") ?: return null,
            mobileSecret = obj.text("mobileSecret") ?: return null,
            desktopName = obj.text("desktopName") ?: return null,
            lanEndpoints = obj.array("lanEndpoints").mapNotNull { (it as? JsonPrimitive)?.takeIf(JsonPrimitive::isString)?.content },
            relayBaseUrl = obj.string("relayBaseUrl"),
        )
    }

    fun readProjectSummaries(value: JsonElement?): List<RemoteProjectSummary> =
        (value as? JsonObject).array("projects").mapNotNull { element ->
            val entry = element as? JsonObject ?: return@mapNotNull null
            val cwd = entry.text("cwd") ?: return@mapNotNull null
            RemoteProjectSummary(
                cwd = cwd,
                name = entry.string("name") ?: cwd,
                kind = if (entry.string("kind") == "conversation") "conversation" else "project",
                sessionCount = entry.double("sessionCount")?.toInt() ?: 0,
            )
        }

    fun readModelOptions(value: JsonElement?): List<RemoteModelOption> =
        (value as? JsonObject).array("models").mapNotNull { element ->
            val entry = element as? JsonObject ?: return@mapNotNull null
            val key = entry.text("key") ?: return@mapNotNull null
            RemoteModelOption(
                key = key,
                name = entry.text("name") ?: key,
                provider = entry.string("provider") ?: key.substringBefore('/'),
                thinkingLevels = entry.array("thinkingLevels").mapNotNull { (it as? JsonPrimitive)?.takeIf(JsonPrimitive::isString)?.content?.takeIf(String::isNotEmpty) },
                defaultThinkingLevel = entry.string("defaultThinkingLevel"),
                supportsImage = entry.bool("supportsImage") == true,
            )
        }
}

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

/** JS truthiness for strings: empty strings count as missing. */
private fun JsonObject.text(key: String): String? = string(key)?.takeIf(String::isNotEmpty)

private fun JsonObject.double(key: String): Double? = (this[key] as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull

private fun JsonObject.long(key: String): Long? = double(key)?.toLong()

private fun JsonObject.bool(key: String): Boolean? = (this[key] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull

private fun JsonObject?.array(key: String): JsonArray = this?.get(key) as? JsonArray ?: JsonArray(emptyList())
