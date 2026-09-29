package org.vetta.android.domain.work

/** What the home screen widget shows: how many sessions wait on the user and how many are at work. */
data class WidgetSummary(
    val state: State,
    val waiting: Int = 0,
    val working: Int = 0,
    /** While offline, when the phone last had the computer online, in epoch milliseconds. */
    val lastSeenAt: Long? = null,
) {
    enum class State {
        /** No computer yet: the widget invites pairing. */
        Unpaired,

        /** Paired, but the counts are the last ones seen before the link went down. */
        Offline,
        Online,
    }

    /** Nothing waiting and nothing running. */
    val idle: Boolean
        get() = waiting == 0 && working == 0

    companion object {
        /**
         * `lastOnline` is when the link was last up, if known; it only shows while offline,
         * so an online widget does not change with every event.
         */
        fun of(mirror: MirrorState, lastOnline: Long? = mirror.desktop?.lastSeenAt?.takeIf { it > 0 }): WidgetSummary =
            when {
                !mirror.paired -> WidgetSummary(State.Unpaired)
                else ->
                    WidgetSummary(
                        state = if (mirror.online) State.Online else State.Offline,
                        waiting = mirror.count(SessionStatusGroup.Waiting),
                        working = mirror.count(SessionStatusGroup.Processing),
                        lastSeenAt = lastOnline.takeUnless { mirror.online },
                    )
            }
    }
}
