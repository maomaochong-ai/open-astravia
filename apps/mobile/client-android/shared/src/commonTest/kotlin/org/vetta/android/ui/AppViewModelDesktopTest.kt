package org.vetta.android.ui

import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.vetta.android.app.AppContainer
import org.vetta.android.app.AppPreferences
import org.vetta.android.core.auth.InMemoryTokenStore
import org.vetta.android.data.session.SettingsSessionStore
import org.vetta.android.domain.device.ConnectChannel
import org.vetta.android.domain.device.DesktopDevice
import org.vetta.android.domain.device.DesktopGateway
import org.vetta.android.domain.device.DeviceStatus
import org.vetta.android.domain.session.ConversationOrigin
import org.vetta.android.resources.Res
import org.vetta.android.resources.invalid_pairing_invite
import org.vetta.android.resources.invalid_pairing_invite_hint
import org.vetta.android.resources.remote_connect_failed
import org.vetta.android.ui.i18n.uiText
import org.vetta.android.ui.navigation.AppRoute
import org.vetta.android.ui.navigation.ChatSurface
import org.vetta.android.ui.navigation.MainTab
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The app shell around the desktop: pairing, and where desktop conversations open. */
@OptIn(ExperimentalCoroutinesApi::class)
class AppViewModelDesktopTest {
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
    fun aDesktopConversationStartsOnTheDesktopsNewSessionPage() =
        runTest(dispatcher) {
            val viewModel = AppViewModel(container(FakeDesktopGateway()))
            advanceUntilIdle()

            viewModel.startDesktopConversation()

            assertEquals(AppRoute.WorkNewSession(), viewModel.state.value.route)
            assertEquals(MainTab.Work, viewModel.state.value.mainTab)
            assertTrue(viewModel.state.value.mainAccessGranted)
            viewModel.handleSystemBack()
            assertEquals(AppRoute.Main(MainTab.Work), viewModel.state.value.route)
        }

    @Test
    fun anEarlierDesktopConversationOpensAsTheDesktopsSessionOrReadOnly() =
        runTest(dispatcher) {
            val container = container(FakeDesktopGateway())
            val viewModel = AppViewModel(container)
            advanceUntilIdle()
            val known = container.sessionStore.createSession(title = "周报", origin = ConversationOrigin.Desktop, remoteDeviceId = "d", remoteSessionId = "runtime-1")
            val orphan = container.sessionStore.createSession(title = "失败的", origin = ConversationOrigin.Desktop, remoteDeviceId = "d")

            viewModel.openStoredSession(known.id)
            advanceUntilIdle()
            assertEquals(AppRoute.WorkSession("runtime-1"), viewModel.state.value.route)

            viewModel.openStoredSession(orphan.id)
            advanceUntilIdle()
            assertEquals(ChatSurface.Desktop, (viewModel.state.value.route as AppRoute.Chat).surface)
            viewModel.onDraftChange("还能发吗")
            viewModel.sendMessage()
            advanceUntilIdle()
            assertTrue(container.sessionStore.getMessages(orphan.id).isEmpty(), "its history is read-only")
        }

    @Test
    fun systemBackClosesModelPickerBeforeLeavingChat() =
        runTest(dispatcher) {
            val viewModel = AppViewModel(container(FakeDesktopGateway()))
            advanceUntilIdle()
            viewModel.skipWelcome()
            viewModel.openCloudChat()
            val chatRoute = viewModel.state.value.route
            viewModel.setModelPicker(true)

            viewModel.handleSystemBack()
            assertEquals(chatRoute, viewModel.state.value.route)
            assertFalse(viewModel.state.value.modelPickerOpen)

            viewModel.handleSystemBack()
            assertEquals(AppRoute.Main(MainTab.Home), viewModel.state.value.route)
        }

    @Test
    fun systemBackFromLoginReturnsToWelcome() =
        runTest(dispatcher) {
            val viewModel = AppViewModel(container(FakeDesktopGateway()))
            advanceUntilIdle()
            viewModel.openLogin()

            viewModel.handleSystemBack()

            assertEquals(AppRoute.Welcome, viewModel.state.value.route)
        }

    @Test
    fun skipWelcomeOpensBrowsableMainShellWithoutCreatingLoginState() =
        runTest(dispatcher) {
            val viewModel = AppViewModel(container(FakeDesktopGateway()))
            advanceUntilIdle()

            assertEquals(AppRoute.Welcome, viewModel.state.value.route)
            viewModel.skipWelcome()

            assertEquals(AppRoute.Main(MainTab.Home), viewModel.state.value.route)
            assertTrue(viewModel.state.value.mainAccessGranted)
            assertEquals(null, viewModel.state.value.user)
        }


    @Test
    fun pairingConnectionIsSingleFlightAndSurfacesFailure() =
        runTest(dispatcher) {
            val gateway = FakeDesktopGateway()
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
            assertEquals(uiText(Res.string.remote_connect_failed), viewModel.state.value.globalError?.title)
        }

    @Test
    fun invalidExternalPairingInviteIsRejectedBeforeNetworkAccess() =
        runTest(dispatcher) {
            val gateway = FakeDesktopGateway()
            val viewModel = AppViewModel(container(gateway))
            advanceUntilIdle()

            viewModel.handlePairingInvite("vetta://pair?relay=https%3A%2F%2Frelay.example&pairingId=short")
            advanceUntilIdle()

            assertEquals(0, gateway.connectCalls)
            assertEquals(AppRoute.Welcome, viewModel.state.value.route)
            assertEquals(uiText(Res.string.invalid_pairing_invite), viewModel.state.value.globalError?.title)
            assertEquals(uiText(Res.string.invalid_pairing_invite_hint), viewModel.state.value.globalError?.message)
        }

    @Test
    fun validExternalPairingInviteConnectsAndOpensDesktopDetail() =
        runTest(dispatcher) {
            val gateway = FakeDesktopGateway()
            val viewModel = AppViewModel(container(gateway))
            advanceUntilIdle()
            val inviteText = validV2Invite()

            viewModel.handlePairingInvite(inviteText)
            advanceUntilIdle()

            assertEquals(1, gateway.connectCalls)
            assertEquals(listOf(inviteText), gateway.connectTargets, "the scanned code goes to pairing as is")
            assertEquals(AppRoute.DeviceDetail("desktop-1"), viewModel.state.value.route)
            assertTrue(viewModel.state.value.mainAccessGranted)
            assertEquals(null, viewModel.state.value.globalError)
        }

    private fun container(gateway: DesktopGateway) =
        AppContainer(
            preferences = AppPreferences(MapSettings()),
            tokenStore = InMemoryTokenStore(),
            sessionStore = SettingsSessionStore(MapSettings()),
            mirror = unpairedMirror(),
            desktopGateway = gateway,
        )

    private fun validV2Invite(): String =
        "vetta://pair?v=2&id=pair-1234567890abcdef" +
            "&s=secret-1234567890abcdefghijklmnop" +
            "&k=V-U_7B2yLhcIrcj6dteUYQTZpeC-YvqqG-h-d--vWyI" +
            "&n=Desktop&relay=https%3A%2F%2Frelay.example"
}

private class FakeDesktopGateway : DesktopGateway {
    override val devices =
        MutableStateFlow(
            listOf(
                DesktopDevice(
                    id = "desktop-1",
                    name = "DEV-PC",
                    osLabel = "Windows 11",
                    host = "relay.example",
                    status = DeviceStatus.Online,
                    channel = ConnectChannel.Remote,
                ),
            ),
        )
    var pendingConnection: CompletableDeferred<Boolean>? = null
    var connectCalls = 0
    val connectTargets = mutableListOf<String>()

    override suspend fun connect(target: String): Boolean {
        connectTargets += target
        connectCalls += 1
        return pendingConnection?.await() ?: true
    }

    override suspend fun disconnect(deviceId: String) {
        devices.value = emptyList()
    }
}
