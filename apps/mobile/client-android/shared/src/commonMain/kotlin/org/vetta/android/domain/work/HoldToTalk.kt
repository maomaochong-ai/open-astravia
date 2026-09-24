package org.vetta.android.domain.work

import kotlin.math.sqrt

/**
 * The composer's press on an empty field (port of the iOS `HoldToTalk.swift`):
 * a quick tap starts typing, holding starts dictation, sliding up while
 * listening arms cancel, and letting go either inserts what was heard or throws
 * it away. Distances are in dp and times in milliseconds.
 */
class HoldToTalk {
    sealed interface Phase {
        data object Idle : Phase

        data class Pressing(val since: Long) : Phase

        data class Listening(val cancelArmed: Boolean) : Phase

        /** Moved away before the hold registered; ignore the rest of this touch. */
        data object Abandoned : Phase
    }

    sealed interface Action {
        data object None : Action

        /** A plain tap: start typing. */
        data object Focus : Action

        data object StartListening : Action

        data class CancelArmed(val armed: Boolean) : Action

        /** Released while listening: insert the transcript unless cancel was armed. */
        data class Finish(val insert: Boolean) : Action
    }

    var phase: Phase = Phase.Idle
        private set

    fun began(at: Long): Action {
        phase = Phase.Pressing(at)
        return Action.None
    }

    /** Called while the finger is down, including by a timer when it holds still. */
    fun moved(dx: Float, dy: Float, at: Long): Action =
        when (val current = phase) {
            is Phase.Pressing ->
                when {
                    sqrt(dx * dx + dy * dy) > SLOP_DP -> {
                        phase = Phase.Abandoned
                        Action.None
                    }
                    at - current.since < HOLD_DELAY_MS -> Action.None
                    else -> {
                        phase = Phase.Listening(cancelArmed = false)
                        Action.StartListening
                    }
                }
            is Phase.Listening -> {
                val armed = dy < -CANCEL_DISTANCE_DP
                if (armed == current.cancelArmed) {
                    Action.None
                } else {
                    phase = Phase.Listening(armed)
                    Action.CancelArmed(armed)
                }
            }
            Phase.Idle, Phase.Abandoned -> Action.None
        }

    fun ended(at: Long): Action {
        val current = phase
        phase = Phase.Idle
        return when (current) {
            is Phase.Pressing -> if (at - current.since < HOLD_DELAY_MS) Action.Focus else Action.None
            is Phase.Listening -> Action.Finish(insert = !current.cancelArmed)
            Phase.Idle, Phase.Abandoned -> Action.None
        }
    }

    companion object {
        /** Long enough that a tap to type is still a tap, short enough that talking feels immediate. */
        const val HOLD_DELAY_MS = 200L

        /** Moving further than this before the hold registers is a scroll or swipe, not a press. */
        const val SLOP_DP = 12f

        /** Sliding up this far while listening arms cancel. */
        const val CANCEL_DISTANCE_DP = 60f
    }
}
