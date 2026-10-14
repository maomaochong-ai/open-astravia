package org.astravia.android.ui.settings

import android.os.Build
import org.astravia.android.core.DeviceName

actual fun phoneModel(): String = DeviceName.pick(null, Build.MANUFACTURER, Build.MODEL)
