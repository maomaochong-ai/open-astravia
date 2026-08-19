package org.vetta.android.domain.conversation

import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.Test
import org.junit.runner.RunWith
import org.vetta.android.core.model.ChatMessage
import org.vetta.android.core.model.ChatRole
import org.vetta.android.core.model.ChatStreamEvent
import kotlin.test.assertEquals

/**
 * Runs only when the host fake relay and Desktop Connector harness are started.
 * The Android emulator maps 10.0.2.2 to the host machine.
 */
@RunWith(AndroidJUnit4::class)
class RelayDesktopConnectorE2ETest {
    @Test
    fun emulatorStreamsThroughHostDesktopConnector() =
        runBlocking {
            val gateway = RelayRemoteConversationGateway()
            gateway.connect("ws://10.0.2.2:8787/relay/mobile-desktop-e2e/mobile")

            val events = mutableListOf<ChatStreamEvent>()
            gateway
                .stream(
                    localSessionId = "emulator-session",
                    deviceId = "desktop-harness",
                    remoteSessionId = null,
                    messages = listOf(ChatMessage(ChatRole.User, "emulator hello")),
                ).collect { events += it }

            assertEquals("desktop:emulator hello", (events.first() as ChatStreamEvent.Delta).text)
            assertEquals(ChatStreamEvent.Done, events.last())
            gateway.disconnect("desktop-harness")
        }
}
