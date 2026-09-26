package org.vetta.android.domain.work

import org.vetta.android.domain.remote.RemoteQuestionAnswer
import org.vetta.android.domain.remote.RemoteQuestionRequest

/**
 * What can be answered straight from a notification, without opening the app. Only a
 * single question qualifies: several need the full panel to answer in turn. Its options
 * become buttons when there are few enough to fit and only one may be picked; a typed
 * reply always works, as the question panel's "Other" does.
 */
object QuickReply {
    /** The most buttons a notification shows. */
    const val MAX_CHOICES = 3

    fun canReply(request: RemoteQuestionRequest): Boolean = request.questions.size == 1

    /** The option labels to offer as buttons, or none when they would not fit or allow several. */
    fun choices(request: RemoteQuestionRequest): List<String> {
        val question = request.questions.singleOrNull() ?: return emptyList()
        if (question.multiSelect || question.options.size !in 1..MAX_CHOICES) return emptyList()
        return question.options.map { it.label }
    }

    /** The line a notification shows for the question. */
    fun prompt(request: RemoteQuestionRequest): String? =
        request.questions.singleOrNull()?.question?.trim()?.takeIf { it.isNotEmpty() }

    fun answer(request: RemoteQuestionRequest, reply: String): List<RemoteQuestionAnswer>? {
        val question = request.questions.singleOrNull() ?: return null
        val text = reply.trim().takeIf { it.isNotEmpty() } ?: return null
        return listOf(RemoteQuestionAnswer(question.question, listOf(text)))
    }
}
