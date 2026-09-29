package org.vetta.android.ui.settings

import androidx.compose.runtime.Composable

/** Whether the app may post notifications, and how to ask; `request` reports the answer. */
class NotificationAccess(val granted: Boolean, val request: () -> Unit)

@Composable
expect fun rememberNotificationAccess(onResult: (Boolean) -> Unit): NotificationAccess
