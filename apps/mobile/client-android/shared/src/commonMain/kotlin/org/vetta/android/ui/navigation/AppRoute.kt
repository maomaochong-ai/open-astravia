package org.vetta.android.ui.navigation

/** What the root shows: one session at a time, New Session when there is none (the iPhone's `Slot`). */
sealed interface Slot {
    /** `projectCwd` is chosen up front; `null` starts in the desktop's conversations. */
    data class NewSession(val projectCwd: String? = null) : Slot

    /** One desktop session; `sessionId` may be the local id of one New Session is starting. */
    data class Session(val sessionId: String) : Slot
}

/** Pages inside the Home drawer, pushed over Home's list. */
sealed interface HomePage {
    data class Project(val cwd: String) : HomePage

    data object Settings : HomePage
}
