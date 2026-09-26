package org.vetta.android.domain.work

/**
 * Where the app opens when started from outside it: a home screen shortcut or the quick
 * settings tile. Each is named by an intent action, so the system can pin it.
 */
enum class LaunchTarget(val action: String) {
    NewSession("org.vetta.android.action.NEW_SESSION"),
    TaskBoard("org.vetta.android.action.TASK_BOARD"),
    RemoteControl("org.vetta.android.action.REMOTE_CONTROL"),
    ;

    companion object {
        fun fromAction(action: String?): LaunchTarget? = entries.firstOrNull { it.action == action }
    }
}
