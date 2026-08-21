package org.vetta.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.vetta.android.app.AppContainer
import org.vetta.android.app.ThemeMode
import org.vetta.android.core.model.ChatRole
import org.vetta.android.core.model.ChatStreamEvent
import org.vetta.android.core.model.LlmModel
import org.vetta.android.core.model.SubscriptionStatus
import org.vetta.android.core.model.User
import org.vetta.android.core.net.RefreshOutcome
import org.vetta.android.domain.chat.prepareRetryTurn
import org.vetta.android.domain.chat.shouldClearPendingImagesOnSessionChange
import org.vetta.android.domain.error.ErrorMapper
import org.vetta.android.domain.error.UiError
import org.vetta.android.domain.error.UiErrorAction
import org.vetta.android.domain.device.DesktopDevice
import org.vetta.android.domain.device.SessionListItem
import org.vetta.android.domain.session.ConversationOrigin
import org.vetta.android.domain.session.LocalMessage
import org.vetta.android.domain.session.MessageImage
import org.vetta.android.domain.session.MessageStatus
import org.vetta.android.domain.session.SessionStore
import org.vetta.android.domain.session.nowEpochMs
import org.vetta.android.ui.i18n.Str
import org.vetta.android.ui.navigation.AppRoute
import org.vetta.android.ui.navigation.ChatSurface
import org.vetta.android.ui.navigation.MainTab
import kotlin.random.Random

data class AppUiState(
    val bootstrapped: Boolean = false,
    val mainAccessGranted: Boolean = false,
    val route: AppRoute = AppRoute.Boot,
    val mainTab: MainTab = MainTab.Home,
    val themeMode: ThemeMode = ThemeMode.System,
    val autoResumeLastSession: Boolean = true,
    val motionEnabled: Boolean = true,
    val confirmBeforeDelete: Boolean = true,
    val serverUrl: String = "",
    val user: User? = null,
    val subscription: SubscriptionStatus? = null,
    val models: List<LlmModel> = emptyList(),
    val selectedModelId: String? = null,
    val currentSessionId: String? = null,
    val messages: List<LocalMessage> = emptyList(),
    val draft: String = "",
    val pendingImages: List<MessageImage> = emptyList(),
    val isStreaming: Boolean = false,
    val modelPickerOpen: Boolean = false,
    val remoteConnecting: Boolean = false,
    val globalError: UiError? = null,
    val authError: UiError? = null,
    val authLoading: Boolean = false,
    val loginModeEmail: Boolean = true,
    val catalogLoading: Boolean = false,
    val passwordVisible: Boolean = false,
    val sessionQuery: String = "",
    val sessionFilterIndex: Int = 0,
    val discoverChannelIndex: Int = 0,
    val newConversationChannelIndex: Int = 0,
    val devices: List<DesktopDevice> = emptyList(),
)

private data class PreferenceSnapshot(
    val theme: ThemeMode,
    val server: String,
    val autoResume: Boolean,
    val motion: Boolean,
    val confirmDelete: Boolean,
)

class AppViewModel(
    private val container: AppContainer,
) : ViewModel() {
    private val _state =
        MutableStateFlow(
            AppUiState(
                themeMode = container.preferences.themeMode.value,
                serverUrl = container.preferences.serverUrl.value,
                autoResumeLastSession = container.preferences.autoResumeLastSession.value,
                motionEnabled = container.preferences.motionEnabled.value,
                confirmBeforeDelete = container.preferences.confirmBeforeDelete.value,
            ),
        )
    val state: StateFlow<AppUiState> = _state.asStateFlow()

    private var streamJob: Job? = null
    private var messagesCollectJob: Job? = null
    private val drafts = mutableMapOf<String, String>()
    private var pendingLoginAction: PendingLoginAction? = null

    init {
        viewModelScope.launch {
            combine(
                container.preferences.themeMode,
                container.preferences.serverUrl,
                container.preferences.autoResumeLastSession,
                container.preferences.motionEnabled,
                container.preferences.confirmBeforeDelete,
            ) { theme, server, autoResume, motion, confirmDelete ->
                PreferenceSnapshot(theme, server, autoResume, motion, confirmDelete)
            }
                .collect { preferences ->
                    _state.update {
                        it.copy(
                            themeMode = preferences.theme,
                            serverUrl = preferences.server,
                            autoResumeLastSession = preferences.autoResume,
                            motionEnabled = preferences.motion,
                            confirmBeforeDelete = preferences.confirmDelete,
                        )
                    }
                }
        }
        viewModelScope.launch {
            container.unauthorizedEpoch.collect { epoch ->
                if (epoch > 0) {
                    forceLogout(keepLocalSessions = true, message = "登录已失效，请重新登录")
                }
            }
        }
        viewModelScope.launch {
            container.remoteConversationGateway.devices.collect { devices ->
                _state.update { it.copy(devices = devices) }
            }
        }
        bootstrap()
    }

    private fun bootstrap() {
        viewModelScope.launch {
            val loggedIn = container.tokenStore.accessToken != null
            if (!loggedIn) {
                _state.update {
                    it.copy(bootstrapped = true, route = AppRoute.Welcome)
                }
                return@launch
            }
            when (val refresh = container.client.auth.refresh()) {
                is RefreshOutcome.Ok, RefreshOutcome.Transient -> {
                    // Transient：保留会话，尽量拉用户信息
                    loadWorkspace(openLastSession = container.preferences.autoResumeLastSession.value)
                }
                RefreshOutcome.Unauthorized -> {
                    container.tokenStore.clear()
                    _state.update {
                        it.copy(
                            bootstrapped = true,
                            route = AppRoute.Login,
                            authError =
                                UiError(
                                    title = "需要重新登录",
                                    message = "登录已失效，请重新登录",
                                    action = UiErrorAction.None,
                                ),
                        )
                    }
                }
            }
        }
    }

    private suspend fun loadWorkspace(openLastSession: Boolean) {
        _state.update { it.copy(catalogLoading = true, globalError = null) }
        try {
            val user = runCatching { container.client.auth.me() }.getOrNull()
            val sub = runCatching { container.client.subscription.me() }.getOrNull()
            val models =
                runCatching { container.client.models.listGoModels() }
                    .getOrElse { emptyList() }
            val selected =
                resolveModelId(
                    preferred = container.preferences.lastModelId,
                    models = models,
                )
            val lastSessionId = container.preferences.lastSessionId
            val routeSession =
                if (openLastSession && lastSessionId != null &&
                    container.sessionStore.getSession(lastSessionId) != null
                ) {
                    lastSessionId
                } else {
                    null
                }
            _state.update {
                it.copy(
                    bootstrapped = true,
                    mainAccessGranted = true,
                    user = user,
                    subscription = sub,
                    models = models,
                    selectedModelId = selected,
                    route = AppRoute.Main(MainTab.Home),
                    mainTab = MainTab.Home,
                    currentSessionId = routeSession,
                    catalogLoading = false,
                )
            }
            if (routeSession != null) {
                // 保留 last session 引用，进入主页后用户可从最近会话打开
            }
        } catch (t: Throwable) {
            _state.update {
                it.copy(
                    bootstrapped = true,
                    catalogLoading = false,
                    route = AppRoute.Main(MainTab.Home),
                    mainTab = MainTab.Home,
                    globalError = ErrorMapper.from(t),
                )
            }
        }
    }

    fun openWelcome() = navigate(AppRoute.Welcome)

    fun openLogin() = navigate(AppRoute.Login)

    fun skipWelcome() {
        _state.update {
            it.copy(
                bootstrapped = true,
                mainAccessGranted = true,
                route = AppRoute.Main(MainTab.Home),
                mainTab = MainTab.Home,
                globalError = null,
                authError = null,
            )
        }
    }

    fun openPlan() = navigate(AppRoute.Plan)

    fun openSettings() = navigate(AppRoute.Settings)

    fun openAbout() = navigate(AppRoute.About)

    /** 登录后继续用户刚刚发起的高意图操作，避免登录成功后把用户丢回首页。 */
    fun openCloudConversation() {
        if (_state.value.user == null) {
            pendingLoginAction = PendingLoginAction.CloudConversation
            openLogin()
        } else {
            newChat()
        }
    }

    fun selectMainTab(tab: MainTab) {
        _state.update {
            it.copy(
                mainTab = tab,
                route = AppRoute.Main(tab),
                authError = null,
            )
        }
    }

    fun openDeviceDetail(deviceId: String) = navigate(AppRoute.DeviceDetail(deviceId))

    fun openNewConversation(channelIndex: Int = 0) {
        _state.update { it.copy(newConversationChannelIndex = channelIndex) }
        navigate(AppRoute.NewConversation())
    }

    fun setNewConversationChannel(index: Int) {
        _state.update { it.copy(newConversationChannelIndex = index) }
    }

    fun setDiscoverChannel(index: Int) {
        _state.update { it.copy(discoverChannelIndex = index) }
    }

    fun handlePairingInvite(target: String) {
        if (org.vetta.android.domain.remote.parsePairingInvite(target) == null) {
            _state.update {
                it.copy(
                    route = AppRoute.Welcome,
                    globalError =
                        UiError(
                            title = Str.invalidPairingInvite,
                            message = Str.invalidPairingInviteHint,
                            action = UiErrorAction.None,
                        ),
                )
            }
            return
        }
        navigate(AppRoute.Welcome)
        connectDesktop(target)
    }

    fun connectDesktop(target: String) {
        if (_state.value.remoteConnecting) return
        _state.update { it.copy(remoteConnecting = true, globalError = null) }
        viewModelScope.launch {
            try {
                val invite = org.vetta.android.domain.remote.parsePairingInvite(target)
                val savedResume =
                    invite?.let {
                        container.preferences.remoteResumeSecret?.takeIf { secret ->
                            container.preferences.remotePairingId == it.pairingId && secret.isNotBlank()
                        }
                    }
                val resume = invite?.let { savedResume ?: newRemoteResumeSecret() }
                val candidateTargets =
                    if (invite == null) {
                        listOf(target)
                    } else {
                        buildList {
                            if (savedResume != null) {
                                add(org.vetta.android.domain.remote.buildMobileResumeTarget(invite, savedResume))
                            }
                            add(org.vetta.android.domain.remote.buildMobileBootstrapTarget(invite, requireNotNull(resume)))
                        }
                    }
                var connected = false
                for (candidate in candidateTargets) {
                    if (runCatching { container.remoteConversationGateway.connect(candidate) }.getOrDefault(false)) {
                        connected = true
                        break
                    }
                }
                if (connected) {
                    _state.update { it.copy(mainAccessGranted = true) }
                    if (invite != null && resume != null) {
                        container.preferences.remotePairingId = invite.pairingId
                        container.preferences.remoteResumeSecret = resume
                    }
                    val device = container.remoteConversationGateway.devices.value.firstOrNull()
                    if (device != null) openDeviceDetail(device.id)
                    return@launch
                }
                _state.update {
                    it.copy(
                        globalError =
                            UiError(
                                title = Str.remoteConnectFailed,
                                message = Str.remoteConnectFailedHint,
                                action = UiErrorAction.None,
                            ),
                    )
                }
            } finally {
                _state.update { it.copy(remoteConnecting = false) }
            }
        }
    }

    private fun newRemoteResumeSecret(): String =
        buildString(43) {
            repeat(43) { append("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".random()) }
        }

    fun disconnectDesktop(deviceId: String) {
        viewModelScope.launch {
            runCatching { container.remoteConversationGateway.disconnect(deviceId) }
            navigateBackFromSecondary()
        }
    }

    fun setSessionQuery(query: String) {
        _state.update { it.copy(sessionQuery = query) }
    }

    fun setSessionFilter(index: Int) {
        _state.update { it.copy(sessionFilterIndex = index) }
    }

    fun openChat(
        sessionId: String?,
        surface: ChatSurface = ChatSurface.Cloud,
        title: String = "",
        deviceId: String? = null,
    ) {
        val previousSessionId = _state.value.currentSessionId
        val clearPending =
            shouldClearPendingImagesOnSessionChange(previousSessionId, sessionId)
        navigate(
            AppRoute.Chat(
                sessionId = sessionId,
                surface = surface,
                title = title,
                deviceId = deviceId,
            ),
        )
        if (sessionId != null) {
            attachSession(sessionId, clearPendingImages = clearPending)
        } else {
            detachSessionMessages()
            _state.update {
                it.copy(
                    currentSessionId = null,
                    messages = emptyList(),
                    draft = "",
                    pendingImages = if (clearPending) emptyList() else it.pendingImages,
                )
            }
        }
    }

    fun openCloudChat(sessionId: String? = null) {
        openChat(sessionId = sessionId, surface = ChatSurface.Cloud, title = Str.channelCloud)
    }

    fun navigateBackFromSecondary() {
        // QR pairing is an independent entry path; a connected Desktop is enough to use the main shell.
        if (_state.value.mainAccessGranted || _state.value.user != null || _state.value.devices.isNotEmpty()) {
            navigate(AppRoute.Main(_state.value.mainTab))
        } else {
            navigate(AppRoute.Welcome)
        }
    }

    fun handleSystemBack() {
        if (_state.value.modelPickerOpen) {
            setModelPicker(false)
            return
        }
        when (_state.value.route) {
            AppRoute.Login -> openWelcome()
            AppRoute.Boot,
            AppRoute.Welcome,
            is AppRoute.Main,
            -> Unit
            else -> navigateBackFromSecondary()
        }
    }

    private fun navigate(route: AppRoute) {
        _state.update { it.copy(route = route, authError = null) }
    }

    fun setModelPicker(open: Boolean) {
        _state.update { it.copy(modelPickerOpen = open) }
    }

    fun sessionListItems(): List<SessionListItem> =
        container.sessionStore.sessions.value.map { s ->
            val remoteDevice = s.remoteDeviceId?.let { id -> _state.value.devices.firstOrNull { it.id == id } }
            SessionListItem(
                id = s.id,
                title = s.title,
                subtitle =
                    if (s.origin == ConversationOrigin.Desktop) {
                        remoteDevice?.host.orEmpty()
                    } else {
                        s.modelName.orEmpty()
                    },
                sourceLabel =
                    if (s.origin == ConversationOrigin.Desktop) {
                        remoteDevice?.name ?: Str.desktopDevice
                    } else {
                        s.modelName?.takeIf { it.isNotBlank() } ?: Str.filterCloud
                    },
                timeLabel = relativeTime(s.updatedAtEpochMs),
                isCloud = s.origin == ConversationOrigin.Cloud,
            )
        }

    private fun relativeTime(epochMs: Long): String {
        val delta = (nowEpochMs() - epochMs).coerceAtLeast(0)
        val minutes = delta / 60_000
        return when {
            minutes < 1 -> "刚刚"
            minutes < 60 -> "${minutes} 分钟前"
            minutes < 60 * 24 -> "${minutes / 60} 小时前"
            else -> "${minutes / (60 * 24)} 天前"
        }
    }

    fun setLoginModeEmail(email: Boolean) {
        _state.update { it.copy(loginModeEmail = email) }
    }

    fun setPasswordVisible(visible: Boolean) {
        _state.update { it.copy(passwordVisible = visible) }
    }

    fun clearAuthError() {
        _state.update { it.copy(authError = null) }
    }

    fun clearGlobalError() {
        _state.update { it.copy(globalError = null) }
    }

    fun onDraftChange(value: String) {
        val sid = _state.value.currentSessionId
        if (sid != null) drafts[sid] = value
        _state.update { it.copy(draft = value) }
    }

    fun addPendingImages(images: List<MessageImage>) {
        if (images.isEmpty()) return
        _state.update { state ->
            state.copy(pendingImages = (state.pendingImages + images).distinctBy { it.id }.take(6))
        }
    }

    fun removePendingImage(id: String) {
        _state.update { it.copy(pendingImages = it.pendingImages.filterNot { img -> img.id == id }) }
    }

    fun selectModel(model: LlmModel) {
        container.preferences.lastModelId = model.id
        _state.update { it.copy(selectedModelId = model.id, modelPickerOpen = false) }
        val sid = _state.value.currentSessionId
        if (sid != null) {
            viewModelScope.launch {
                val session = container.sessionStore.getSession(sid) ?: return@launch
                if (session.origin != ConversationOrigin.Cloud) return@launch
                container.sessionStore.updateSession(
                    session.copy(modelId = model.id, modelName = model.name),
                )
            }
        }
    }

    fun setThemeMode(mode: ThemeMode) {
        container.preferences.setThemeMode(mode)
    }

    fun setAutoResumeLastSession(enabled: Boolean) {
        container.preferences.setAutoResumeLastSession(enabled)
    }

    fun setMotionEnabled(enabled: Boolean) {
        container.preferences.setMotionEnabled(enabled)
    }

    fun setConfirmBeforeDelete(enabled: Boolean) {
        container.preferences.setConfirmBeforeDelete(enabled)
    }

    fun clearLocalSessions() {
        viewModelScope.launch {
            streamJob?.cancel()
            streamJob = null
            messagesCollectJob?.cancel()
            messagesCollectJob = null
            container.sessionStore.sessions.value.map { it.id }.forEach { id ->
                container.sessionStore.deleteSession(id)
            }
            drafts.clear()
            container.preferences.lastSessionId = null
            _state.update {
                it.copy(
                    currentSessionId = null,
                    messages = emptyList(),
                    draft = "",
                    pendingImages = emptyList(),
                    modelPickerOpen = false,
                )
            }
        }
    }

    fun login(accountOrEmail: String, password: String) {
        viewModelScope.launch {
            _state.update { it.copy(authLoading = true, authError = null) }
            try {
                if (_state.value.loginModeEmail) {
                    container.client.auth.loginWithEmailPassword(accountOrEmail, password)
                } else {
                    container.client.auth.loginWithAccount(accountOrEmail, password)
                }
                val pendingAction = pendingLoginAction
                pendingLoginAction = null
                loadWorkspace(openLastSession = true)
                if (pendingAction == PendingLoginAction.CloudConversation) {
                    newChat()
                }
            } catch (t: Throwable) {
                _state.update {
                    it.copy(authLoading = false, authError = ErrorMapper.from(t))
                }
                return@launch
            }
            _state.update { it.copy(authLoading = false) }
        }
    }

    private enum class PendingLoginAction {
        CloudConversation,
    }

    fun logout(clearLocalSessions: Boolean) {
        viewModelScope.launch {
            streamJob?.cancel()
            runCatching { container.client.auth.logout() }
            forceLogout(keepLocalSessions = !clearLocalSessions)
        }
    }

    private suspend fun forceLogout(keepLocalSessions: Boolean, message: String? = null) {
        streamJob?.cancel()
        container.tokenStore.clear()
        if (!keepLocalSessions) {
            container.sessionStore.sessions.value.map { it.id }.forEach {
                container.sessionStore.deleteSession(it)
            }
        }
        drafts.clear()
        container.preferences.lastSessionId = null
        _state.update {
            it.copy(
                user = null,
                subscription = null,
                models = emptyList(),
                selectedModelId = null,
                currentSessionId = null,
                messages = emptyList(),
                draft = "",
                pendingImages = emptyList(),
                isStreaming = false,
                route = AppRoute.Login,
                mainTab = MainTab.Home,
                modelPickerOpen = false,
                authError =
                    message?.let {
                        UiError(title = "已退出", message = it, action = UiErrorAction.None)
                    },
            )
        }
    }

    fun refreshCatalog() {
        viewModelScope.launch {
            _state.update { it.copy(catalogLoading = true) }
            try {
                val sub = container.client.subscription.me()
                val models = container.client.models.listGoModels()
                val selected =
                    resolveModelId(_state.value.selectedModelId ?: container.preferences.lastModelId, models)
                _state.update {
                    it.copy(
                        subscription = sub,
                        models = models,
                        selectedModelId = selected,
                        catalogLoading = false,
                        globalError = null,
                    )
                }
            } catch (t: Throwable) {
                _state.update {
                    it.copy(catalogLoading = false, globalError = ErrorMapper.from(t))
                }
            }
        }
    }

    fun newChat() {
        viewModelScope.launch {
            streamJob?.cancel()
            val model = currentModel()
            val session =
                container.sessionStore.createSession(
                    title = SessionStore.DEFAULT_TITLE,
                    modelId = model?.id,
                    modelName = model?.name,
                )
            container.preferences.lastSessionId = session.id
            drafts[session.id] = ""
            _state.update { it.copy(pendingImages = emptyList()) }
            openChat(
                sessionId = session.id,
                surface = ChatSurface.Cloud,
                title = session.title,
            )
        }
    }

    fun startDesktopConversation(deviceId: String) {
        viewModelScope.launch {
            val device = _state.value.devices.firstOrNull { it.id == deviceId }
            if (device == null) {
                _state.update {
                    it.copy(
                        globalError =
                            UiError(
                                title = Str.desktopUnavailable,
                                message = Str.desktopUnavailableHint,
                                action = UiErrorAction.None,
                            ),
                    )
                }
                return@launch
            }
            _state.update { it.copy(mainAccessGranted = true) }
            val session =
                container.sessionStore.createSession(
                    title = Str.conversationWith.replace("%s", device.name),
                    origin = ConversationOrigin.Desktop,
                    remoteDeviceId = deviceId,
                )
            openChat(
                sessionId = session.id,
                surface = ChatSurface.Desktop,
                title = session.title,
                deviceId = deviceId,
            )
        }
    }

    fun deleteSession(sessionId: String) {
        viewModelScope.launch {
            if (_state.value.currentSessionId == sessionId) {
                streamJob?.cancel()
            }
            container.sessionStore.deleteSession(sessionId)
            drafts.remove(sessionId)
            if (container.preferences.lastSessionId == sessionId) {
                container.preferences.lastSessionId = null
            }
            if (_state.value.currentSessionId == sessionId) {
                navigateBackFromSecondary()
            }
        }
    }

    fun renameSession(sessionId: String, title: String) {
        viewModelScope.launch {
            val session = container.sessionStore.getSession(sessionId) ?: return@launch
            val cleaned = title.trim().ifBlank { SessionStore.DEFAULT_TITLE }
            container.sessionStore.updateSession(session.copy(title = cleaned))
        }
    }

    fun sendMessage() {
        val text = _state.value.draft.trim()
        val images = _state.value.pendingImages
        if ((text.isEmpty() && images.isEmpty()) || _state.value.isStreaming) return

        viewModelScope.launch {
            val model = currentModel()
            var sessionId = _state.value.currentSessionId
            if (sessionId == null) {
                val route = _state.value.route as? AppRoute.Chat
                val origin =
                    if (route?.surface == ChatSurface.Desktop) {
                        ConversationOrigin.Desktop
                    } else {
                        ConversationOrigin.Cloud
                    }
                if (origin == ConversationOrigin.Cloud && model == null) {
                    showNoModelError()
                    return@launch
                }
                if (origin == ConversationOrigin.Desktop && route?.deviceId == null) {
                    _state.update {
                        it.copy(
                            globalError =
                                UiError(
                                    title = Str.desktopUnavailable,
                                    message = Str.desktopSessionMissingHint,
                                    action = UiErrorAction.None,
                                ),
                        )
                    }
                    return@launch
                }
                val session =
                    container.sessionStore.createSession(
                        modelId = model?.id,
                        modelName = model?.name,
                        origin = origin,
                        remoteDeviceId = route?.deviceId,
                    )
                sessionId = session.id
                container.preferences.lastSessionId = sessionId
                attachSession(sessionId)
                val surface =
                    (_state.value.route as? AppRoute.Chat)?.surface ?: ChatSurface.Cloud
                _state.update {
                    it.copy(
                        currentSessionId = sessionId,
                        route =
                            AppRoute.Chat(
                                sessionId = sessionId,
                                surface = surface,
                                title = (_state.value.route as? AppRoute.Chat)?.title.orEmpty(),
                                deviceId = (_state.value.route as? AppRoute.Chat)?.deviceId,
                            ),
                    )
                }
            }

            val sid = sessionId
            val session = container.sessionStore.getSession(sid) ?: return@launch
            if (session.origin == ConversationOrigin.Cloud && model == null && session.modelId == null) {
                showNoModelError()
                return@launch
            }
            val userMsg =
                LocalMessage(
                    id = newMessageId(),
                    sessionId = sid,
                    role = ChatRole.User,
                    content = text,
                    status = MessageStatus.Complete,
                    createdAtEpochMs = nowEpochMs(),
                    images = images,
                )
            val assistantId = newMessageId()
            val assistantMsg =
                LocalMessage(
                    id = assistantId,
                    sessionId = sid,
                    role = ChatRole.Assistant,
                    content = "",
                    status = MessageStatus.Streaming,
                    createdAtEpochMs = nowEpochMs() + 1,
                )
            container.sessionStore.upsertMessage(userMsg)
            container.sessionStore.upsertMessage(assistantMsg)
            drafts[sid] = ""
            _state.update {
                it.copy(draft = "", pendingImages = emptyList(), isStreaming = true, globalError = null)
            }

            val history =
                container.sessionStore
                    .getMessages(sid)
                    .filter {
                        it.id != assistantId &&
                            it.status != MessageStatus.Error &&
                            it.hasVisualContent
                    }.map { it.toChatMessage() }

            streamJob?.cancel()
            streamJob =
                viewModelScope.launch {
                    var assembled = ""
                    try {
                        container.conversationRouter
                            .stream(
                                session = session,
                                selectedModelId = model?.id,
                                messages = history,
                            )
                            .collect { event ->
                                when (event) {
                                    is ChatStreamEvent.Delta -> {
                                        assembled += event.text
                                        container.sessionStore.upsertMessage(
                                            assistantMsg.copy(
                                                content = assembled,
                                                status = MessageStatus.Streaming,
                                            ),
                                        )
                                    }
                                    is ChatStreamEvent.Finished -> Unit
                                    ChatStreamEvent.Done -> {
                                        container.sessionStore.upsertMessage(
                                            assistantMsg.copy(
                                                content = assembled,
                                                status = MessageStatus.Complete,
                                            ),
                                        )
                                    }
                                    is ChatStreamEvent.Error -> {
                                        val ui = ErrorMapper.from(event.exception)
                                        container.sessionStore.upsertMessage(
                                            assistantMsg.copy(
                                                content = assembled,
                                                status = MessageStatus.Error,
                                                errorMessage = ui.message,
                                            ),
                                        )
                                        _state.update { it.copy(globalError = ui) }
                                    }
                                }
                            }
                        if (session.origin == ConversationOrigin.Desktop && session.remoteSessionId == null) {
                            container.conversationRouter.resolvedRemoteSessionId(session.id)?.let { remoteId ->
                                container.sessionStore.updateSession(session.copy(remoteSessionId = remoteId))
                            }
                        }
                        // 正常结束后若仍 streaming 则 complete
                        val latest =
                            container.sessionStore.getMessages(sid).firstOrNull { it.id == assistantId }
                        if (latest?.status == MessageStatus.Streaming) {
                            container.sessionStore.upsertMessage(
                                latest.copy(status = MessageStatus.Complete),
                            )
                        }
                    } catch (t: Throwable) {
                        val ui = ErrorMapper.from(t)
                        val latest =
                            container.sessionStore.getMessages(sid).firstOrNull { it.id == assistantId }
                        if (latest != null) {
                            container.sessionStore.upsertMessage(
                                latest.copy(
                                    status =
                                        if (t is kotlinx.coroutines.CancellationException) {
                                            MessageStatus.Aborted
                                        } else {
                                            MessageStatus.Error
                                        },
                                    errorMessage = if (t is kotlinx.coroutines.CancellationException) null else ui.message,
                                ),
                            )
                        }
                        if (t !is kotlinx.coroutines.CancellationException) {
                            _state.update { it.copy(globalError = ui) }
                        }
                    } finally {
                        _state.update { it.copy(isStreaming = false) }
                    }
                }
        }
    }

    fun stopStreaming() {
        streamJob?.cancel()
        streamJob = null
        val sid = _state.value.currentSessionId ?: return
        viewModelScope.launch {
            container.sessionStore.getSession(sid)?.let { session ->
                runCatching { container.conversationRouter.abort(session) }
            }
            val streaming =
                container.sessionStore.getMessages(sid).lastOrNull {
                    it.role == ChatRole.Assistant && it.status == MessageStatus.Streaming
                }
            if (streaming != null) {
                container.sessionStore.upsertMessage(streaming.copy(status = MessageStatus.Aborted))
            }
            _state.update { it.copy(isStreaming = false) }
        }
    }

    fun retryLastError() {
        val sid = _state.value.currentSessionId ?: return
        viewModelScope.launch {
            val messages = container.sessionStore.getMessages(sid)
            val turn = prepareRetryTurn(messages) ?: return@launch
            container.sessionStore.replaceMessages(sid, turn.remainingMessages)
            drafts[sid] = turn.draft
            // 必须同时恢复图片；否则纯图重试会变成 no-op，图文重试会丢图
            _state.update {
                it.copy(
                    draft = turn.draft,
                    pendingImages = turn.images,
                    globalError = null,
                )
            }
            sendMessage()
        }
    }

    fun handleErrorAction(action: UiErrorAction) {
        when (action) {
            UiErrorAction.Retry -> {
                clearGlobalError()
                if (_state.value.route is AppRoute.Chat) retryLastError() else refreshCatalog()
            }
            UiErrorAction.OpenPlan -> {
                clearGlobalError()
                openPlan()
            }
            UiErrorAction.ReLogin -> {
                clearGlobalError()
                viewModelScope.launch { forceLogout(keepLocalSessions = true) }
            }
            UiErrorAction.OpenSettings -> {
                clearGlobalError()
                openSettings()
            }
            UiErrorAction.None -> clearGlobalError()
        }
    }

    val sessions =
        container.sessionStore.sessions
            .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    private fun attachSession(
        sessionId: String,
        clearPendingImages: Boolean = true,
    ) {
        messagesCollectJob?.cancel()
        container.preferences.lastSessionId = sessionId
        val draft = drafts[sessionId].orEmpty()
        _state.update {
            it.copy(
                currentSessionId = sessionId,
                draft = draft,
                pendingImages = if (clearPendingImages) emptyList() else it.pendingImages,
            )
        }
        messagesCollectJob =
            viewModelScope.launch {
                container.sessionStore.observeMessages(sessionId).collect { list ->
                    _state.update { state -> state.copy(messages = list) }
                }
            }
    }

    private fun detachSessionMessages() {
        messagesCollectJob?.cancel()
        messagesCollectJob = null
    }

    private fun currentModel(): LlmModel? {
        val id = _state.value.selectedModelId
        return _state.value.models.firstOrNull { it.id == id } ?: _state.value.models.firstOrNull()
    }

    private fun showNoModelError() {
        _state.update {
            it.copy(
                globalError =
                    UiError(
                        title = Str.noModels,
                        message = Str.noModelsHint,
                        action = UiErrorAction.OpenPlan,
                    ),
            )
        }
    }

    private fun resolveModelId(preferred: String?, models: List<LlmModel>): String? {
        if (models.isEmpty()) return null
        if (preferred != null && models.any { it.id == preferred }) return preferred
        return models.first().id
    }

    private fun newMessageId(): String =
        "${nowEpochMs().toString(16)}-${Random.nextInt(0, Int.MAX_VALUE).toString(16)}"
}
