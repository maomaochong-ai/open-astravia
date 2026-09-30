package org.vetta.android.domain.remote

import kotlin.math.min

/** What a remote desktop session does when its signaling socket to the relay drops. */
sealed interface SignalingDrop {
    /** Not connected directly yet: without signaling the session cannot finish setting up. */
    data object Stop : SignalingDrop

    /**
     * The direct link is up and never went through the relay: reopen signaling after this
     * long and keep the screen, input and control flowing meanwhile.
     */
    data class Reconnect(val afterMs: Long) : SignalingDrop
}

/**
 * Backs off reopening signaling while the relay is away (a restart, a deploy, a blip), so a
 * session connected directly outlives it. Mirrors the desktop's capture page and iOS.
 */
class SignalingRetry {
    private var attempt = 0

    fun dropped(directlyConnected: Boolean): SignalingDrop {
        if (!directlyConnected) return SignalingDrop.Stop
        val delay = min(FIRST_DELAY_MS shl min(attempt, 5), MAX_DELAY_MS)
        attempt += 1
        return SignalingDrop.Reconnect(delay)
    }

    fun reopened() {
        attempt = 0
    }

    companion object {
        const val FIRST_DELAY_MS = 1_000L
        const val MAX_DELAY_MS = 30_000L
    }
}
