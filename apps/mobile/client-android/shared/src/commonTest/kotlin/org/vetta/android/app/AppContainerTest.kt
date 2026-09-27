package org.vetta.android.app

import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.test.runTest
import org.vetta.android.data.remote.MemorySessionCache
import org.vetta.android.domain.remote.pairing.SettingsSecretStore
import org.vetta.android.domain.work.DesktopMirror
import org.vetta.android.domain.work.MirrorPlatform
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AppContainerTest {
    @Test
    fun aSecondScreenOpeningOverTheFirstKeepsTheAppOnScreen() =
        runTest {
            val mirror =
                DesktopMirror(
                    MirrorPlatform(
                        settings = MapSettings(),
                        secrets = SettingsSecretStore(MapSettings()),
                        cache = MemorySessionCache(),
                        createTransport = { _, _ -> error("no computer in this test") },
                        deviceName = "Pixel",
                        now = { 0 },
                    ),
                    backgroundScope,
                )
            val container = AppContainer(preferences = AppPreferences(MapSettings()), scope = backgroundScope, mirror = mirror)
            assertFalse(container.visible.value)

            container.screenStarted()
            // A shortcut opens another screen: it starts before the covered one stops.
            container.screenStarted()
            container.screenStopped()
            assertTrue(container.visible.value, "the new screen is showing")

            container.screenStopped()
            assertFalse(container.visible.value)
            container.screenStopped()
            assertFalse(container.visible.value, "an extra stop does not go below none")
            container.screenStarted()
            assertTrue(container.visible.value)
        }
}
