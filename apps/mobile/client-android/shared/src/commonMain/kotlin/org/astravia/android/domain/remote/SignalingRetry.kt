package org.astravia.android.domain.remote

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

    /**
     * The socket dropped after it opened, or failed to open outright. Without a direct link there
     * is nothing left to carry the session, so that case is final instead of retried.
     */
    fun dropped(directlyConnected: Boolean): SignalingDrop {
        if (!directlyConnected) return SignalingDrop.Stop
        return backoff()
    }

    /**
     * The upgrade never completed within the open timeout, which says the relay is unreachable
     * rather than merely away: DNS, TCP or TLS swallowed the request. Retrying is worth it — a
     * blackholed network recovers — but a viewer that has no picture to fall back on stops after
     * [OPEN_ATTEMPT_LIMIT] tries instead of saying `connecting` for ever.
     */
    fun openTimedOut(directlyConnected: Boolean): SignalingDrop {
        if (directlyConnected) return backoff()
        if (attempt >= OPEN_ATTEMPT_LIMIT) return SignalingDrop.Stop
        return backoff()
    }

    fun reopened() {
        attempt = 0
    }

    /** One call spends one try, so the caller's limit counts attempts rather than waits. */
    private fun backoff(): SignalingDrop.Reconnect {
        val delay = min(FIRST_DELAY_MS shl min(attempt, 5), MAX_DELAY_MS)
        attempt += 1
        return SignalingDrop.Reconnect(delay)
    }

    companion object {
        const val FIRST_DELAY_MS = 1_000L
        const val MAX_DELAY_MS = 30_000L

        /** Open timeouts are 10 s each and their backoff adds up, so this is roughly a minute. */
        const val OPEN_ATTEMPT_LIMIT = 4
    }
}
