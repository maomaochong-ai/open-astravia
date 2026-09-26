package org.vetta.android.ui.remote

import android.app.Activity
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext

@Composable
actual fun LandscapeWhile(landscape: Boolean) {
    val context = LocalContext.current
    DisposableEffect(context, landscape) {
        var found = context
        while (found is ContextWrapper && found !is Activity) found = found.baseContext
        val activity = found as? Activity
        if (landscape) activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        onDispose {
            if (landscape) activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }
}
