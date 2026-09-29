package org.vetta.android.domain.work

import org.vetta.android.domain.remote.RemoteProjectSummary
import org.vetta.android.domain.remote.RemoteSessionSummary

/**
 * One project as the home search and the project picker list it, worked out from the
 * phone's session list (port of the iOS `HomeDigest.swift`): the desktop's project
 * list carries no activity time.
 */
data class ProjectDigest(
    val cwd: String,
    val name: String,
    val sessionCount: Int,
    /** The newest session's `updatedAt`; 0 for a project with no session on the phone. */
    val updatedAt: Long,
) {
    companion object {
        /**
         * Every project, most recently active first. Projects the desktop lists but the
         * phone has no session for come last, with the desktop's count. The conversation
         * bucket is not a project; while it is unknown nothing is listed, so it never shows up as one.
         */
        fun all(
            sessions: List<RemoteSessionSummary>,
            projects: List<RemoteProjectSummary> = emptyList(),
            conversationCwd: String?,
        ): List<ProjectDigest> {
            if (conversationCwd == null) return emptyList()
            val grouped = sessions.filter { it.projectCwd != conversationCwd }.groupBy { it.projectCwd }
            val digests =
                grouped.map { (cwd, list) ->
                    ProjectDigest(cwd, list.first().projectName, list.size, list.maxOf { it.updatedAt })
                } +
                    projects
                        .filter { !it.isConversation && it.cwd !in grouped }
                        .map { ProjectDigest(it.cwd, it.name, it.sessionCount, 0) }
            return digests.sortedWith(
                compareByDescending<ProjectDigest> { it.updatedAt }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.name },
            )
        }
    }
}

/** The home search, run on the phone over what the session list already holds. */
object HomeSearch {
    /** Title, preview and project name, ignoring case, accents and width; a blank query matches everything. */
    fun matches(session: RemoteSessionSummary, query: String): Boolean {
        val terms = terms(query)
        if (terms.isEmpty()) return true
        val haystack = listOf(session.title, session.preview.orEmpty(), session.projectName).map(::fold)
        return terms.all { term -> haystack.any { term in it } }
    }

    fun matches(project: ProjectDigest, query: String): Boolean {
        val terms = terms(query)
        val name = fold(project.name)
        return terms.isNotEmpty() && terms.all { it in name }
    }

    private fun terms(query: String): List<String> = query.split(WHITESPACE).filter(String::isNotEmpty).map(::fold)

    /** Lower case, without accents, and with full-width Latin letters and digits made half-width. */
    internal fun fold(text: String): String =
        buildString(text.length) {
            for (char in stripAccents(text)) {
                append(
                    when (char) {
                        in '！'..'～' -> char - 0xFEE0
                        '　' -> ' '
                        else -> char
                    }.lowercaseChar(),
                )
            }
        }

    private val WHITESPACE = Regex("\\s+")
}

/** `text` with combining accents removed, so "é" matches "e". */
internal expect fun stripAccents(text: String): String
