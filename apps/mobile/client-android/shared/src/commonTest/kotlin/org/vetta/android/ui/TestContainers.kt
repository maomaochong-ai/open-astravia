package org.vetta.android.ui

import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.vetta.android.data.remote.MemorySessionCache
import org.vetta.android.domain.work.DesktopMirror
import org.vetta.android.domain.work.MirrorPlatform

/** A desktop mirror with nothing paired and nothing to reach, for tests of other screens. */
fun unpairedMirror(scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)): DesktopMirror =
    DesktopMirror(
        MirrorPlatform(
            settings = MapSettings(),
            secrets = MapSettings(),
            cache = MemorySessionCache(),
            createTransport = { _, _ -> error("this test has no desktop") },
            deviceName = "Test",
            now = { 0L },
        ),
        scope,
    )
