package org.vetta.android.domain.work

import org.vetta.android.domain.remote.RemoteQuestionAnswer
import org.vetta.android.domain.remote.RemoteQuestionRequest

/**
 * The answers being given to one AskUserQuestion request, with the desktop
 * panel's rules: single choice or several, plus a free-text "Other".
 */
data class QuestionDraft(
    val request: RemoteQuestionRequest,
    /** The question on screen when there are several. */
    val current: Int = 0,
    private val selected: Map<Int, List<String>> = emptyMap(),
    private val otherActive: Map<Int, Boolean> = emptyMap(),
    private val otherTexts: Map<Int, String> = emptyMap(),
) {
    val count: Int
        get() = request.questions.size

    val isLast: Boolean
        get() = current >= count - 1

    val answeredCount: Int
        get() = request.questions.indices.count(::isAnswered)

    val allAnswered: Boolean
        get() = answeredCount == count

    fun isSelected(label: String, index: Int): Boolean = selected[index].orEmpty().contains(label)

    fun isOtherActive(index: Int): Boolean = otherActive[index] == true

    fun otherText(index: Int): String = otherTexts[index].orEmpty()

    /** The chosen labels, then the Other text when it is on and not blank. */
    fun answers(index: Int): List<String> {
        val other = otherText(index).trim()
        return selected[index].orEmpty() + if (isOtherActive(index) && other.isNotEmpty()) listOf(other) else emptyList()
    }

    fun isAnswered(index: Int): Boolean = answers(index).isNotEmpty()

    fun toggle(label: String, index: Int): QuestionDraft {
        val question = request.questions.getOrNull(index) ?: return this
        return if (question.multiSelect) {
            val current = selected[index].orEmpty()
            copy(selected = selected + (index to if (label in current) current - label else current + label))
        } else {
            // One answer only: picking an option turns Other off.
            copy(selected = selected + (index to listOf(label)), otherActive = otherActive + (index to false))
        }
    }

    fun toggleOther(index: Int): QuestionDraft = settingOther(!isOtherActive(index), index)

    /** Typing an answer switches Other on. */
    fun settingOtherText(text: String, index: Int): QuestionDraft {
        val next = copy(otherTexts = otherTexts + (index to text))
        return if (text.isNotEmpty() && !isOtherActive(index)) next.settingOther(true, index) else next
    }

    private fun settingOther(active: Boolean, index: Int): QuestionDraft {
        val question = request.questions.getOrNull(index) ?: return this
        val next = copy(otherActive = otherActive + (index to active))
        return if (active && !question.multiSelect) next.copy(selected = selected + (index to emptyList())) else next
    }

    fun next(): QuestionDraft = if (isLast) this else copy(current = current + 1)

    fun showing(index: Int): QuestionDraft = if (index in request.questions.indices) copy(current = index) else this

    /** One answer entry per question, in order, as `session.respond` takes them. */
    val result: List<RemoteQuestionAnswer>
        get() = request.questions.mapIndexed { index, question -> RemoteQuestionAnswer(question.question, answers(index)) }
}
