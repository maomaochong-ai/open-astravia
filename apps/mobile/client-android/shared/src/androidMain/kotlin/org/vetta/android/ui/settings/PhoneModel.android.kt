package org.vetta.android.ui.settings

import android.os.Build
import org.vetta.android.core.DeviceName

actual fun phoneModel(): String = DeviceName.pick(null, Build.MANUFACTURER, Build.MODEL)
