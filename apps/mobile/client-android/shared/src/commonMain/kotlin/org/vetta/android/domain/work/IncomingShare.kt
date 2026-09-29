package org.vetta.android.domain.work

/**
 * Text and files another app shared into Vetta, to start a session with. `skipped`
 * counts what could not be read or would not fit one upload.
 */
data class IncomingShare(
    val text: String = "",
    val attachments: List<PromptAttachment> = emptyList(),
    val skipped: Int = 0,
) {
    val isEmpty: Boolean
        get() = text.isBlank() && attachments.isEmpty() && skipped == 0

    /**
     * Adds the share to what New Session already holds: the text on a line of its own after
     * anything typed, the attachments while there is room. Returns the draft and how many
     * items were left out in all.
     */
    fun into(draft: PromptDraft): Pair<PromptDraft, Int> {
        val shared = text.trim()
        var next =
            when {
                shared.isEmpty() -> draft
                draft.text.isBlank() -> draft.copy(text = shared)
                else -> draft.copy(text = draft.text.trimEnd() + "\n" + shared)
            }
        var left = skipped
        for (attachment in attachments) {
            next =
                try {
                    next.adding(attachment)
                } catch (_: PromptAttachmentError) {
                    left += 1
                    next
                }
        }
        return next to left
    }
}
