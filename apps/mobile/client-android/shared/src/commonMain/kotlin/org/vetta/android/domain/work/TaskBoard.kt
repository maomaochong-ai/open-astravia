package org.vetta.android.domain.work

import org.vetta.android.domain.remote.RemoteSessionSummary

/**
 * One card on the task board (port of the iOS `TaskBoard.swift`): a project, or the
 * desktop's conversations, with the sessions worth a look: every one that waits or
 * runs, then its newest finished ones until there are at least a few.
 */
data class TaskBoardCard(
    val cwd: String,
    val name: String,
    val isConversation: Boolean,
    /**
     * Waiting and running sessions first, most recent first within each and capped, then
     * the newest others up to [TaskBoard.RECENT_LIMIT] in all.
     */
    val sessions: List<RemoteSessionSummary>,
    /** Waiting or running sessions left off the card by the cap. */
    val hidden: Int,
    val waiting: Int,
    val running: Int,
    /** The newest session's `updatedAt`. */
    val updatedAt: Long,
) {
    val active: Boolean
        get() = waiting + running > 0

    /**
     * What orders the board: waiting 100, running 10, the conversations 5 and a project
     * all done 1, added up, so a card that both waits and runs outranks one that only waits.
     */
    val score: Int
        get() =
            (if (waiting > 0) 100 else 0) + (if (running > 0) 10 else 0) + (if (isConversation) 5 else 0) +
                (if (active || isConversation) 0 else 1)
}

object TaskBoard {
    /** Projects with nothing waiting or running beyond these are left to Home's list. */
    const val DONE_PROJECT_LIMIT = 6

    /** Sessions a card lists at least, when it has that many. */
    const val RECENT_LIMIT = 3

    /** Waiting or running sessions a card lists before it points to the rest. */
    const val ACTIVE_LIMIT = 5

    /**
     * Every card, highest score first and the most recently active first within a score.
     * Nothing until the conversation bucket is known, so it never passes for a project.
     */
    fun cards(sessions: List<RemoteSessionSummary>, conversationCwd: String?): List<TaskBoardCard> {
        if (conversationCwd == null) return emptyList()
        val all =
            sessions
                .groupBy { it.projectCwd }
                .map { (cwd, grouped) -> card(cwd, grouped, isConversation = cwd == conversationCwd) }
                .sortedWith(ranking)
        var doneProjects = 0
        return all.filter { card ->
            if (card.active || card.isConversation) return@filter true
            doneProjects += 1
            doneProjects <= DONE_PROJECT_LIMIT
        }
    }

    /**
     * Splits cards into columns for a waterfall, each card going to the shortest column
     * so far, measured in rows; reading left to right, top to bottom keeps the ranking.
     */
    fun columns(cards: List<TaskBoardCard>, count: Int): List<List<TaskBoardCard>> {
        if (count <= 0) return emptyList()
        val columns = List(count) { mutableListOf<TaskBoardCard>() }
        val heights = IntArray(count)
        for (card in cards) {
            val shortest = heights.indices.minBy { heights[it] }
            columns[shortest].add(card)
            // The name and the card's padding weigh about two rows.
            heights[shortest] += card.sessions.size + (if (card.hidden > 0) 1 else 0) + 2
        }
        return columns
    }

    private fun card(cwd: String, sessions: List<RemoteSessionSummary>, isConversation: Boolean): TaskBoardCard {
        val newest = sessions.sortedByDescending { it.updatedAt }
        val waiting = newest.filter { SessionStatusGroup.of(it.status) == SessionStatusGroup.Waiting }
        val running = newest.filter { SessionStatusGroup.of(it.status) == SessionStatusGroup.Processing }
        val active = waiting + running
        return TaskBoardCard(
            cwd = cwd,
            name = sessions.first().projectName,
            isConversation = isConversation,
            // Short of RECENT_LIMIT, the newest finished ones fill the card up.
            sessions = active.take(ACTIVE_LIMIT) + newest.filterNot { it in active }.take((RECENT_LIMIT - active.size).coerceAtLeast(0)),
            hidden = (active.size - ACTIVE_LIMIT).coerceAtLeast(0),
            waiting = waiting.size,
            running = running.size,
            updatedAt = newest.first().updatedAt,
        )
    }

    private val ranking: Comparator<TaskBoardCard> =
        compareByDescending<TaskBoardCard> { it.score }
            .thenByDescending { it.updatedAt }
            .thenBy(String.CASE_INSENSITIVE_ORDER) { it.name }
}
