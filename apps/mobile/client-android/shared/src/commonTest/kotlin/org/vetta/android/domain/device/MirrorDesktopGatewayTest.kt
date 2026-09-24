package org.vetta.android.domain.device

import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.vetta.android.data.remote.MemorySessionCache
import org.vetta.android.domain.remote.protocol.RemoteRequestMethod
import org.vetta.android.domain.work.DesktopMirror
import org.vetta.android.domain.work.FakeDesktop
import org.vetta.android.domain.work.MirrorPlatform
import org.vetta.android.domain.work.eventually
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The paired desktop as the Home, Discover and device screens see it. */
class MirrorDesktopGatewayTest {
    private fun TestScope.paired(): Pair<FakeDesktop, MirrorDesktopGateway> {
        val desktop = FakeDesktop(backgroundScope)
        desktop.handler = { request ->
            respond(
                request.requestId,
                if (request.method == RemoteRequestMethod.DiagnosticsSnapshot) {
                    buildJsonObject {
                        put("osLabel", "Windows 11")
                        put("cpu", "Test CPU")
                        put("ram", "16 GB")
                    }
                } else {
                    buildJsonObject {}
                },
            )
        }
        val mirror =
            DesktopMirror(
                MirrorPlatform(
                    settings = MapSettings(),
                    secrets = MapSettings(),
                    cache = MemorySessionCache(),
                    createTransport = desktop.createTransport,
                    deviceName = "Pixel",
                    now = { testScheduler.currentTime },
                ),
                backgroundScope,
            ).also { it.start() }
        return desktop to MirrorDesktopGateway(mirror, backgroundScope)
    }

    @Test
    fun describesThePairedDesktopAsItsDevice() =
        runTest {
            val (desktop, gateway) = paired()
            assertTrue(gateway.devices.value.isEmpty(), "nothing is paired yet")
            gateway.connect(desktop.invite(name = "DEV-PC"))
            assertTrue(eventually { gateway.devices.value.singleOrNull()?.cpu == "Test CPU" })
            val device = gateway.devices.value.single()
            assertEquals(desktop.identityKey, device.id)
            assertEquals("DEV-PC", device.name)
            assertEquals("Windows 11", device.osLabel)
            assertEquals(ConnectChannel.Remote, device.channel)
            assertEquals(
                "wss://relay.example/v2/desktop/${FakeDesktop.PAIRING_ID}/viewer#pairing=${FakeDesktop.MOBILE_SECRET}",
                device.viewerUrl,
            )

            gateway.disconnect(device.id)
            assertTrue(eventually { gateway.devices.value.isEmpty() }, "disconnecting forgets the pairing")
        }
}
