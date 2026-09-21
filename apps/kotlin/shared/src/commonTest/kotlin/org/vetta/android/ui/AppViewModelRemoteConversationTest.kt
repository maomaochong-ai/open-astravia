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
import org.vetta.android.core.model.ChatQuestion
import org.vetta.android.core.model.ChatQuestionOption
import org.vetta.android.core.model.ChatRole
import org.vetta.android.core.model.ChatStreamEvent
import org.vetta.android.data.session.SettingsSessionStore
import org.vetta.android.domain.conversation.RemoteConversationGateway
import org.vetta.android.domain.device.ConnectChannel
import org.vetta.android.domain.device.DesktopDevice
import org.vetta.android.domain.device.DeviceStatus
import org.vetta.android.domain.remote.buildMobileBootstrapTarget
import org.vetta.android.domain.remote.buildMobileResumeTarget
import org.vetta.android.domain.remote.parsePairingInvite
import org.vetta.android.domain.session.ConversationOrigin
import org.vetta.android.domain.session.LocalMessage
import org.vetta.android.domain.session.MessageStatus
import org.vetta.android.domain.session.PendingQuestion
import org.vetta.android.ui.i18n.Str
import org.vetta.android.ui.navigation.AppRoute
import org.vetta.android.ui.navigation.MainTab
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
    fun desktopQuestionIsVisibleAndRespondedWithoutLosingSession() =
        runTest(dispatcher) {
            val gateway = FakeRemoteConversationGateway().apply {
                streamEvents =
                    listOf(
                        ChatStreamEvent.UserInputRequired(
                            requestId = "question-1",
                            questions =
                                listOf(
                                    ChatQuestion(
                                        question = "选择执行方式",
                                        options = listOf(ChatQuestionOption("继续")),
                                    ),
                                ),
                        ),
                    )
                streamCompletion = CompletableDeferred()
            }
            val container = container(gateway)
            val viewModel = AppViewModel(container)
            advanceUntilIdle()

            viewModel.startDesktopConversation("desktop-1")
            advanceUntilIdle()
            viewModel.onDraftChange("执行任务")
            viewModel.sendMessage()
            advanceUntilIdle()

            val pending = assertNotNull(viewModel.state.value.pendingQuestion)
            assertEquals("question-1", pending.requestId)
            viewModel.toggleQuestionOption("选择执行方式", "继续")
            viewModel.submitQuestion()
            advanceUntilIdle()

            assertEquals(
                listOf("选择执行方式" to listOf("继续")),
                gateway.respondCalls.single().answers,
            )
            assertEquals("remote-${viewModel.state.value.currentSessionId}", gateway.respondCalls.single().remoteSessionId)
            assertEquals(null, viewModel.state.value.pendingQuestion)
            assertTrue(viewModel.state.value.route is AppRoute.Chat)
            assertEquals(viewModel.state.value.currentSessionId, (viewModel.state.value.route as AppRoute.Chat).sessionId)
        }

    @Test
    fun desktopQuestionSubmitIsSingleFlight() =
        runTest(dispatcher) {
            val gateway = FakeRemoteConversationGateway().apply {
                streamEvents =
                    listOf(
                        ChatStreamEvent.UserInputRequired(
                            requestId = "question-single-flight",
                            questions = listOf(ChatQuestion("选择执行方式", options = listOf(ChatQuestionOption("继续")))),
                        ),
                    )
                streamCompletion = CompletableDeferred()
            }
            val viewModel = AppViewModel(container(gateway))
            advanceUntilIdle()
            viewModel.startDesktopConversation("desktop-1")
            advanceUntilIdle()
            viewModel.onDraftChange("执行任务")
            viewModel.sendMessage()
            advanceUntilIdle()
            viewModel.toggleQuestionOption("选择执行方式", "继续")

            viewModel.submitQuestion()
            viewModel.submitQuestion()
            advanceUntilIdle()

            assertEquals(1, gateway.respondCalls.size)
        }

    @Test
    fun pendingDesktopQuestionIsRestoredIntoMainShellAfterViewModelRecreation() =
        runTest(dispatcher) {
            val settings = MapSettings()
            val store = SettingsSessionStore(settings)
            val session = store.createSession(title = "待确认", origin = ConversationOrigin.Desktop, remoteDeviceId = "desktop-1")
            store.upsertMessage(
                LocalMessage(
                    id = "assistant-pending",
                    sessionId = session.id,
                    role = ChatRole.Assistant,
                    content = "",
                    status = MessageStatus.Streaming,
                    createdAtEpochMs = 1,
                    pendingQuestion =
                        PendingQuestion(
                            sessionId = session.id,
                            requestId = "request-rehydrated",
                            questions = listOf(ChatQuestion("需要继续吗？")),
                        ),
                ),
            )
            val container =
                AppContainer(
                    preferences = AppPreferences(settings),
                    tokenStore = InMemoryTokenStore(),
                    sessionStore = store,
                    remoteConversationGateway = FakeRemoteConversationGateway(),
                )
            val viewModel = AppViewModel(container)
            advanceUntilIdle()

            assertEquals("request-rehydrated", viewModel.state.value.pendingQuestion?.requestId)
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
    fun connectedDesktopBackReturnsToMainWithoutLogin() =
        runTest(dispatcher) {
            val gateway = FakeRemoteConversationGateway()
            val viewModel = AppViewModel(container(gateway))
            advanceUntilIdle()

            viewModel.startDesktopConversation("desktop-1")
            advanceUntilIdle()
            gateway.devices.value = emptyList()
            viewModel.navigateBackFromSecondary()

            assertEquals(AppRoute.Main(MainTab.Home), viewModel.state.value.route)
        }

    @Test
    fun systemBackFromDesktopChatReturnsToMain() =
        runTest(dispatcher) {
            val viewModel = AppViewModel(container(FakeRemoteConversationGateway()))
            advanceUntilIdle()
            viewModel.startDesktopConversation("desktop-1")
            advanceUntilIdle()

            viewModel.handleSystemBack()

            assertEquals(AppRoute.Main(MainTab.Home), viewModel.state.value.route)
        }

    @Test
    fun systemBackClosesModelPickerBeforeLeavingChat() =
        runTest(dispatcher) {
            val viewModel = AppViewModel(container(FakeRemoteConversationGateway()))
            advanceUntilIdle()
            viewModel.startDesktopConversation("desktop-1")
            advanceUntilIdle()
            val chatRoute = viewModel.state.value.route
            viewModel.setModelPicker(true)

            viewModel.handleSystemBack()

            assertEquals(chatRoute, viewModel.state.value.route)
            assertFalse(viewModel.state.value.modelPickerOpen)
        }

    @Test
    fun systemBackFromLoginReturnsToWelcome() =
        runTest(dispatcher) {
            val viewModel = AppViewModel(container(FakeRemoteConversationGateway()))
            advanceUntilIdle()
            viewModel.openLogin()

            viewModel.handleSystemBack()

            assertEquals(AppRoute.Welcome, viewModel.state.value.route)
        }

    @Test
    fun skipWelcomeOpensBrowsableMainShellWithoutCreatingLoginState() =
        runTest(dispatcher) {
            val viewModel = AppViewModel(container(FakeRemoteConversationGateway()))
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

    @Test
    fun invalidExternalPairingInviteIsRejectedBeforeNetworkAccess() =
        runTest(dispatcher) {
            val gateway = FakeRemoteConversationGateway()
            val viewModel = AppViewModel(container(gateway))
            advanceUntilIdle()

            viewModel.handlePairingInvite("vetta://pair?relay=https%3A%2F%2Frelay.example&pairingId=short")
            advanceUntilIdle()

            assertEquals(0, gateway.connectCalls)
            assertEquals(AppRoute.Welcome, viewModel.state.value.route)
            assertEquals(Str.invalidPairingInvite, viewModel.state.value.globalError?.title)
            assertEquals(Str.invalidPairingInviteHint, viewModel.state.value.globalError?.message)
        }

    @Test
    fun validExternalPairingInviteConnectsAndOpensDesktopDetail() =
        runTest(dispatcher) {
            val gateway = FakeRemoteConversationGateway()
            val viewModel = AppViewModel(container(gateway))
            advanceUntilIdle()
            val inviteText =
                "vetta://pair?relay=https%3A%2F%2Frelay.example&pairingId=pairing_0123456789abcdefghijklmno&bootstrap=secret_0123456789abcdefghijklmnopqrstuvwxyz"

            viewModel.handlePairingInvite(inviteText)
            advanceUntilIdle()

            assertEquals(1, gateway.connectCalls)
            assertTrue(gateway.connectTargets.single().startsWith("wss://relay.example/v1/relay/"))
            assertEquals(AppRoute.DeviceDetail("desktop-1"), viewModel.state.value.route)
            assertTrue(viewModel.state.value.mainAccessGranted)
            assertEquals(null, viewModel.state.value.globalError)
        }

    @Test
    fun savedPairingUsesResumeCredentialBeforeBootstrapFallback() =
        runTest(dispatcher) {
            val gateway = FakeRemoteConversationGateway().apply { connectResults = listOf(false, true) }
            val preferences = AppPreferences(MapSettings())
            val inviteText =
                "vetta://pair?relay=https%3A%2F%2Frelay.example&pairingId=pairing_0123456789abcdefghijklmno&bootstrap=secret_0123456789abcdefghijklmnopqrstuvwxyz"
            val invite = requireNotNull(parsePairingInvite(inviteText))
            val resume = "resume_0123456789abcdefghijklmnopqrstuvwxyz"
            preferences.remotePairingId = invite.pairingId
            preferences.remoteResumeSecret = resume
            val viewModel = AppViewModel(container(gateway, preferences))
            advanceUntilIdle()

            viewModel.connectDesktop(inviteText)
            advanceUntilIdle()

            assertEquals(
                listOf(
                    buildMobileResumeTarget(invite, resume),
                    buildMobileBootstrapTarget(invite, resume),
                ),
                gateway.connectTargets,
            )
            assertEquals(null, viewModel.state.value.globalError)
        }

    @Test
    fun failedNewPairingDoesNotReplaceSavedResumeCredential() =
        runTest(dispatcher) {
            val gateway = FakeRemoteConversationGateway().apply { connectResults = listOf(false) }
            val preferences = AppPreferences(MapSettings())
            preferences.remotePairingId = "existing-pairing"
            preferences.remoteResumeSecret = "existing-resume"
            val viewModel = AppViewModel(container(gateway, preferences))
            advanceUntilIdle()

            viewModel.connectDesktop(
                "vetta://pair?relay=https%3A%2F%2Frelay.example&pairingId=pairing_0123456789abcdefghijklmno&bootstrap=secret_0123456789abcdefghijklmnopqrstuvwxyz",
            )
            advanceUntilIdle()

            assertEquals("existing-pairing", preferences.remotePairingId)
            assertEquals("existing-resume", preferences.remoteResumeSecret)
            assertEquals(Str.remoteConnectFailed, viewModel.state.value.globalError?.title)
        }

    private fun container(
        gateway: RemoteConversationGateway,
        preferences: AppPreferences = AppPreferences(MapSettings()),
    ) =
        AppContainer(
            preferences = preferences,
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
    val respondCalls = mutableListOf<RespondCall>()
    val aborted = mutableListOf<String>()
    var streamEvents: List<ChatStreamEvent> =
        listOf(
            ChatStreamEvent.Delta("桌面端"),
            ChatStreamEvent.Delta("回复"),
            ChatStreamEvent.Done,
        )
    var streamCompletion: CompletableDeferred<Unit>? = null
    var pendingConnection: CompletableDeferred<Boolean>? = null
    var connectResults: List<Boolean> = emptyList()
    var connectCalls = 0
    val connectTargets = mutableListOf<String>()

    override suspend fun connect(target: String): Boolean {
        connectTargets += target
        connectCalls += 1
        return pendingConnection?.await() ?: connectResults.getOrNull(connectCalls - 1) ?: true
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
            for (event in streamEvents) emit(event)
            streamCompletion?.await()
        }

    override fun resolvedRemoteSessionId(localSessionId: String): String? = "remote-$localSessionId"

    override suspend fun abort(localSessionId: String, deviceId: String, remoteSessionId: String?) {
        aborted += deviceId
    }

    override suspend fun respond(
        localSessionId: String,
        deviceId: String,
        remoteSessionId: String?,
        requestId: String,
        answers: List<Pair<String, List<String>>>,
        cancelled: Boolean,
    ) {
        respondCalls += RespondCall(requestId, remoteSessionId, answers)
        streamCompletion?.complete(Unit)
    }
}

private data class RespondCall(
    val requestId: String,
    val remoteSessionId: String?,
    val answers: List<Pair<String, List<String>>>,
)
