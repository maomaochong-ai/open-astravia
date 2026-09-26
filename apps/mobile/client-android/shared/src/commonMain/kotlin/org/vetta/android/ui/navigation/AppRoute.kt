package org.vetta.android.ui.navigation

sealed class AppRoute {
    /** The paired desktop's sessions: where the app opens and Back ends. */
    data object Work : AppRoute()

    /**
     * A blank page for starting a desktop session, in `projectCwd` or the desktop's
     * conversations. `returnTo` is the chat it was opened from, where Back goes.
     */
    data class WorkNewSession(val projectCwd: String? = null, val returnTo: String? = null) : AppRoute()

    /** The paired computer, its link, and how the phone works with it. */
    data object WorkSettings : AppRoute()

    /** One desktop session; `sessionId` may be the local id of one New Session is starting. */
    data class WorkSession(val sessionId: String) : AppRoute()
}
