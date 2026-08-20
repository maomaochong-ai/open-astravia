package org.vetta.android.ui

import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.vetta.android.app.AppContainer
import org.vetta.android.app.AppPreferences
import org.vetta.android.core.auth.InMemoryTokenStore
import org.vetta.android.core.model.ChatMessage
import org.vetta.android.core.model.ChatRole
import org.vetta.android.core.model.ChatStreamEvent
import org.vetta.android.data.session.SettingsSessionStore
import org.vetta.android.domain.conversation.RemoteConversationGateway
import org.vetta.android.domain.device.ConnectChannel
import org.vetta.android.domain.device.DesktopDevice
import org.vetta.android.domain.device.DeviceStatus
import org.vetta.android.domain.session.ConversationOrigin
import org.vetta.android.domain.session.MessageStatus
import org.vetta.android.ui.i18n.Str
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class AppViewModelRemoteConversationTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun desktopConversationStreamsWithoutCloudModelOrPhysicalDevice() =
        runTest(dispatcher) {
            val gateway = FakeRemoteConversationGateway()
            val container = container(gateway)
            val viewModel = AppViewModel(container)
            advanceUntilIdle()

            assertTrue(viewModel.state.value.models.isEmpty())
            assertEquals("desktop-1", viewModel.state.value.devices.single().id)

            viewModel.startDesktopConversation("desktop-1")
            advanceUntilIdle()
            val sessionId = assertNotNull(viewModel.state.value.currentSessionId)
            val session = assertNotNull(container.sessionStore.getSession(sessionId))
            assertEquals(ConversationOrigin.Desktop, session.origin)
            assertEquals("desktop-1", session.remoteDeviceId)

            viewModel.onDraftChange("列出当前项目状态")
            viewModel.sendMessage()
            advanceUntilIdle()

            assertEquals(1, gateway.streamCalls.size)
            assertEquals("desktop-1", gateway.streamCalls.single().deviceId)
            assertEquals("列出当前项目状态", gateway.streamCalls.single().messages.single().textContent)
            val messages = container.sessionStore.getMessages(sessionId)
            assertEquals(ChatRole.Assistant, messages.last().role)
            assertEquals("桌面端回复", messages.last().content)
            assertEquals(MessageStatus.Complete, messages.last().status)
            assertEquals(null, viewModel.state.value.globalError)
        }

    @Test
    fun unavailableDeviceDoesNotCreateMisleadingSession() =
        runTest(dispatcher) {
            val gateway = FakeRemoteConversationGateway()
            val container = container(gateway)
            val viewModel = AppViewModel(container)
            advanceUntilIdle()

            viewModel.startDesktopConversation("missing")
            advanceUntilIdle()

            assertTrue(container.sessionStore.sessions.value.isEmpty())
            assertEquals("桌面设备不可用", viewModel.state.value.globalError?.title)
        }

    @Test
    fun pairingConnectionIsSingleFlightAndSurfacesFailure() =
        runTest(dispatcher) {
            val gateway = FakeRemoteConversationGateway()
            val pendingConnection = CompletableDeferred<Boolean>()
            gateway.pendingConnection = pendingConnection
            val viewModel = AppViewModel(container(gateway))
            advanceUntilIdle()

            viewModel.connectDesktop("wss://relay.example.test/room")
            viewModel.connectDesktop("wss://relay.example.test/room")
            runCurrent()

            assertTrue(viewModel.state.value.remoteConnecting)
            assertEquals(1, gateway.connectCalls)

            pendingConnection.complete(false)
            advanceUntilIdle()

            assertFalse(viewModel.state.value.remoteConnecting)
            assertEquals(Str.remoteConnectFailed, viewModel.state.value.globalError?.title)
        }

    private fun container(gateway: RemoteConversationGateway) =
        AppContainer(
            preferences = AppPreferences(MapSettings()),
            tokenStore = InMemoryTokenStore(),
            sessionStore = SettingsSessionStore(MapSettings()),
            remoteConversationGateway = gateway,
        )
}

private data class StreamCall(
    val deviceId: String,
    val remoteSessionId: String?,
    val messages: List<ChatMessage>,
)

private class FakeRemoteConversationGateway : RemoteConversationGateway {
    override val devices =
        MutableStateFlow(
            listOf(
                DesktopDevice(
                    id = "desktop-1",
                    name = "DEV-PC",
                    osLabel = "Windows 11",
                    host = "fake-relay",
                    status = DeviceStatus.Online,
                    channel = ConnectChannel.Remote,
                ),
            ),
        )
    val streamCalls = mutableListOf<StreamCall>()
    val aborted = mutableListOf<String>()
    var pendingConnection: CompletableDeferred<Boolean>? = null
    var connectCalls = 0

    override suspend fun connect(target: String): Boolean {
        connectCalls += 1
        return pendingConnection?.await() ?: true
    }

    override suspend fun disconnect(deviceId: String) {
        devices.value = emptyList()
    }

    override fun stream(
        localSessionId: String,
        deviceId: String,
        remoteSessionId: String?,
        messages: List<ChatMessage>,
    ): Flow<ChatStreamEvent> =
        flow {
            streamCalls += StreamCall(deviceId, remoteSessionId, messages)
            emit(ChatStreamEvent.Delta("桌面端"))
            emit(ChatStreamEvent.Delta("回复"))
            emit(ChatStreamEvent.Done)
        }

    override fun resolvedRemoteSessionId(localSessionId: String): String? = "remote-$localSessionId"

    override suspend fun abort(localSessionId: String, deviceId: String, remoteSessionId: String?) {
        aborted += deviceId
    }
}
