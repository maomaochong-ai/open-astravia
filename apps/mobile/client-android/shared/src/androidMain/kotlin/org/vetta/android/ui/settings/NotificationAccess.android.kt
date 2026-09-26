package org.vetta.android.ui.settings

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import org.vetta.android.app.SessionNotifier

@Composable
actual fun rememberNotificationAccess(onResult: (Boolean) -> Unit): NotificationAccess {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(SessionNotifier.allowed(context)) }
    val result by rememberUpdatedState(onResult)
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
            granted = allowed
            result(allowed)
        }
    return NotificationAccess(granted) {
        // Before Android 13 posting needs no permission.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !granted) launcher.launch(Manifest.permission.POST_NOTIFICATIONS) else result(true)
    }
}
