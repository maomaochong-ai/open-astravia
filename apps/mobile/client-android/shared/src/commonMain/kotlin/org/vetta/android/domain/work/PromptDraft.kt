package org.vetta.android.domain.work

import kotlin.io.encoding.Base64
import kotlin.random.Random
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.vetta.android.domain.remote.AttachmentKind
import org.vetta.android.domain.remote.RemoteApi
import org.vetta.android.domain.remote.RemoteSkillOption
import org.vetta.android.domain.remote.TranscriptAttachment

/** One picture or file the user attached to a prompt, held in memory until it is sent. */
class PromptAttachment(
    val kind: AttachmentKind,
    val name: String,
    val mimeType: String,
    val data: ByteArray,
    val id: String = newAttachmentId(),
) {
    /** The `session.upload` payload. */
    fun toJson(): JsonObject =
        buildJsonObject {
            put("kind", kind.wire)
            put("name", name)
            put("mimeType", mimeType)
            put("data", Base64.encode(data))
        }

    fun toTranscript(): TranscriptAttachment = TranscriptAttachment(kind, name)

    override fun equals(other: Any?): Boolean =
        other is PromptAttachment &&
            other.id == id &&
            other.kind == kind &&
            other.name == name &&
            other.mimeType == mimeType &&
            other.data.contentEquals(data)

    override fun hashCode(): Int = id.hashCode()

    override fun toString(): String = "PromptAttachment(id=$id, kind=$kind, name=$name, bytes=${data.size})"

    private companion object {
        fun newAttachmentId(): String = "attachment-${Random.nextLong().toULong().toString(36)}"
    }
}

sealed class PromptAttachmentError : Exception() {
    data class TooLarge(val name: String) : PromptAttachmentError()

    data object TooMany : PromptAttachmentError()
}

/**
 * What the composer holds before sending: text, attachments and referenced skills,
 * within the limits the link can carry in one encrypted frame.
 */
data class PromptDraft(
    val text: String = "",
    val attachments: List<PromptAttachment> = emptyList(),
    /** In the order they were picked; at most one scene, as on the desktop. */
    val skills: List<SkillReference> = emptyList(),
) {
    val trimmedText: String
        get() = text.trim()

    /** What goes to the desktop: the skill tokens, then the words. */
    val promptText: String
        get() = SkillTokens.prompt(skills, trimmedText)

    /**
     * A prompt needs words or a skill, which is often a whole instruction by itself;
     * attachments ride along with them.
     */
    val canSend: Boolean
        get() = trimmedText.isNotEmpty() || skills.isNotEmpty()

    val isEmpty: Boolean
        get() = trimmedText.isEmpty() && attachments.isEmpty() && skills.isEmpty()

    /** Adds a skill once. A prompt may name one scene, so a new scene replaces the old one. */
    fun addingSkill(skill: SkillReference): PromptDraft {
        if (skill in skills) return this
        val kept = if (skill.kind == RemoteSkillOption.Kind.Scene) skills.filterNot { it.kind == RemoteSkillOption.Kind.Scene } else skills
        return copy(skills = kept + skill)
    }

    fun removingSkill(id: String): PromptDraft = copy(skills = skills.filterNot { it.id == id })

    /** @throws PromptAttachmentError when the attachment cannot travel with this prompt. */
    fun adding(attachment: PromptAttachment): PromptDraft {
        if (attachments.size >= MAX_ATTACHMENTS) throw PromptAttachmentError.TooMany
        if (attachment.data.isEmpty() || attachment.data.size > MAX_ATTACHMENT_BYTES) {
            throw PromptAttachmentError.TooLarge(attachment.name)
        }
        return copy(attachments = attachments + attachment)
    }

    fun removing(id: String): PromptDraft = copy(attachments = attachments.filterNot { it.id == id })

    /**
     * Adds dictated words after what is already typed, with a space only where
     * Latin text would otherwise run together (Chinese needs none).
     */
    fun insertingDictation(dictated: String): PromptDraft {
        val words = dictated.trim()
        if (words.isEmpty()) return this
        val last = text.lastOrNull() ?: return copy(text = words)
        val first = words.first()
        val afterLatin = last.code < 128 && !last.isWhitespace()
        val startsWord = first.code < 128 && first.isLetterOrDigit()
        return copy(text = text + if (afterLatin && startsWord) " $words" else words)
    }

    companion object {
        /**
         * Per attachment, before base64: what one `session.upload` frame carries.
         * Pictures are downscaled to fit; other files are refused.
         */
        const val MAX_ATTACHMENT_BYTES = RemoteApi.MAX_UPLOAD_BYTES
        const val MAX_ATTACHMENTS = 6
    }
}
