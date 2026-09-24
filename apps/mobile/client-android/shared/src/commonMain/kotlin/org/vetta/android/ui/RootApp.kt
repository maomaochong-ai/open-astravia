package org.vetta.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.animation.Crossfade
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.CreationExtras
import androidx.lifecycle.viewmodel.compose.viewModel
import org.vetta.android.app.AppContainer
import org.vetta.android.ui.auth.LoginScreen
import org.vetta.android.ui.auth.WelcomeScreen
import org.vetta.android.ui.chat.ChatScreen
import org.vetta.android.ui.components.LoadingBlock
import org.vetta.android.ui.components.VettaBottomBar
import org.vetta.android.ui.connect.DeviceDetailScreen
import org.vetta.android.ui.connect.DiscoverConnectScreen
import org.vetta.android.ui.connect.NewConversationScreen
import org.vetta.android.ui.home.HomeScreen
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.resources.Res
import org.vetta.android.resources.channel_cloud
import org.vetta.android.resources.pair_desktop
import org.vetta.android.ui.i18n.sessionTitle
import org.vetta.android.ui.me.MeScreen
import org.vetta.android.ui.me.PlanScreen
import org.vetta.android.ui.me.SettingsScreen
import org.vetta.android.ui.me.AboutScreen
import org.vetta.android.ui.navigation.AppRoute
import org.vetta.android.ui.navigation.ChatSurface
import org.vetta.android.ui.navigation.MainTab
import org.vetta.android.ui.navigation.PlatformBackHandler
import org.vetta.android.ui.navigation.hasInAppBackDestination
import org.vetta.android.ui.sessions.SessionsScreen
import org.vetta.android.ui.theme.VettaTheme
import org.vetta.android.ui.work.NewSessionScreen
import org.vetta.android.ui.work.WorkSettingsScreen
import org.vetta.android.resources.work_settings_rescan
import org.vetta.android.resources.work_settings_scan
import org.vetta.android.ui.work.SessionScreen
import org.vetta.android.resources.new_session_title
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.ui.platform.testTag
import org.vetta.android.ui.work.WorkScreen
import org.vetta.android.ui.work.WorkViewModel
import org.vetta.android.domain.work.PromptDraft
import org.vetta.android.domain.work.SessionStatusGroup
import org.vetta.android.ui.remote.PairingScannerButton
import org.vetta.android.resources.work_unpaired_scan
import androidx.compose.material3.CircularProgressIndicator
import kotlin.reflect.KClass

val LocalAppContainer =
    staticCompositionLocalOf<AppContainer> {
        error("AppContainer not provided")
    }

private class WorkViewModelFactory(
    private val container: AppContainer,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(
        modelClass: KClass<T>,
        extras: CreationExtras,
    ): T = WorkViewModel(container.mirror) as T
}

private class AppViewModelFactory(
    private val container: AppContainer,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(
        modelClass: KClass<T>,
        extras: CreationExtras,
    ): T = AppViewModel(container) as T
}

@Composable
fun RootApp(
    container: AppContainer = LocalAppContainer.current,
    pairingInvite: String? = null,
    onPairingInviteHandled: () -> Unit = {},
) {
    val vm: AppViewModel =
        viewModel(factory = remember(container) { AppViewModelFactory(container) })
    val state by vm.state.collectAsState()
    val sessions by vm.sessions.collectAsState()
    val work: WorkViewModel = viewModel(factory = remember(container) { WorkViewModelFactory(container) })
    val workState by work.state.collectAsState()
    val workDrafts by work.drafts.collectAsState()
    val workFilter by work.filter.collectAsState()

    PlatformBackHandler(
        enabled = state.route.hasInAppBackDestination(),
        onBack = vm::handleSystemBack,
    )

    // The desktop link rests in the background and reconnects at once when the app returns.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner, container) {
        val observer =
            LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_START -> container.mirror.setActive(true)
                    Lifecycle.Event.ON_STOP -> container.mirror.setActive(false)
                    else -> Unit
                }
            }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    LaunchedEffect(pairingInvite, state.bootstrapped) {
        if (pairingInvite != null && state.bootstrapped) {
            vm.handlePairingInvite(pairingInvite)
            onPairingInviteHandled()
        }
    }

    VettaTheme(themeMode = state.themeMode) {
        if (!state.bootstrapped || state.route is AppRoute.Boot) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                LoadingBlock()
            }
            return@VettaTheme
        }

        Box(Modifier.fillMaxSize()) {
            Crossfade(
                targetState = state.route,
                animationSpec = tween(durationMillis = if (state.motionEnabled) 200 else 0),
                label = "app route transition",
            ) { route ->
            when (route) {
            AppRoute.Boot -> Unit
            AppRoute.Welcome ->
                WelcomeScreen(
                    connecting = state.remoteConnecting,
                    error = state.globalError,
                    onLogin = vm::openLogin,
                    onScanPairing = vm::connectDesktop,
                    onSkip = vm::skipWelcome,
                    onClearError = vm::clearGlobalError,
                )
            AppRoute.Login ->
                LoginScreen(
                    loading = state.authLoading,
                    error = state.authError,
                    loginModeEmail = state.loginModeEmail,
                    passwordVisible = state.passwordVisible,
                    onToggleMode = vm::setLoginModeEmail,
                    onTogglePassword = vm::setPasswordVisible,
                    onLogin = vm::login,
                    onClearError = vm::clearAuthError,
                    onBack = vm::openWelcome,
                )
            is AppRoute.Main -> {
                Scaffold(
                    bottomBar = {
                        VettaBottomBar(
                            selected = state.mainTab,
                            onSelect = vm::selectMainTab,
                            workBadge = workState.count(SessionStatusGroup.Waiting),
                        )
                    },
                ) { padding ->
                    Box(Modifier.padding(padding).fillMaxSize()) {
                        Crossfade(
                            targetState = state.mainTab,
                            animationSpec = tween(durationMillis = if (state.motionEnabled) 200 else 0),
                            label = "main tab transition",
                        ) { tab ->
                            when (tab) {
                            MainTab.Home ->
                                HomeScreen(
                                    primaryDevice =
                                        state.devices.firstOrNull {
                                            it.status == org.vetta.android.domain.device.DeviceStatus.Online
                                        },
                                    recentSessions = vm.sessionListItems().take(5),
                                    onOpenDevice = vm::openDeviceDetail,
                                    onOpenDevices = { vm.selectMainTab(MainTab.Discover) },
                                    onOpenSessions = { vm.selectMainTab(MainTab.Sessions) },
                                    onOpenSession = vm::openStoredSession,
                                    onNewConversation = { vm.openNewConversation(0) },
                                    onUseCloudAi = vm::openCloudConversation,
                                )
                            MainTab.Work ->
                                WorkScreen(
                                    state = workState,
                                    filter = workFilter,
                                    onFilterChange = work::setFilter,
                                    actions = work,
                                    onOpenSession = vm::openWorkSession,
                                    onRefresh = work::refresh,
                                    onReconnect = work::reconnect,
                                    onNewSession = { vm.openWorkNewSession() },
                                    onSettings = vm::openWorkSettings,
                                    pairing = {
                                        if (state.remoteConnecting) {
                                            CircularProgressIndicator()
                                        } else {
                                            PairingScannerButton(
                                                onScanned = { vm.connectDesktop(it, openDetail = false) },
                                                label = stringResource(Res.string.work_unpaired_scan),
                                            )
                                        }
                                    },
                                )
                            MainTab.Sessions ->
                                SessionsScreen(
                                    sessions = vm.sessionListItems(),
                                    query = state.sessionQuery,
                                    filterIndex = state.sessionFilterIndex,
                                    onQueryChange = vm::setSessionQuery,
                                    onFilterChange = vm::setSessionFilter,
                                    onNewConversation = { vm.openNewConversation(0) },
                                    onRenameSession = vm::renameSession,
                                    onDeleteSession = vm::deleteSession,
                                    confirmBeforeDelete = state.confirmBeforeDelete,
                                    onOpenSession = { item -> vm.openStoredSession(item.id) },
                                )
                            MainTab.Discover ->
                                DiscoverConnectScreen(
                                    devices = state.devices,
                                    channelIndex = state.discoverChannelIndex,
                                    onChannelChange = vm::setDiscoverChannel,
                                    onOpenDevice = vm::openDeviceDetail,
                                    onConnectManual = vm::connectDesktop,
                                    onUseCloud = vm::openCloudConversation,
                                )
                            MainTab.Me ->
                                MeScreen(
                                    user = state.user,
                                    subscription = state.subscription,
                                    onlineDeviceCount =
                                        state.devices.count {
                                            it.status == org.vetta.android.domain.device.DeviceStatus.Online
                                        },
                                    onOpenPlan = vm::openPlan,
                                    onOpenSettings = vm::openSettings,
                                    onOpenDevices = { vm.selectMainTab(MainTab.Discover) },
                                    onOpenAbout = vm::openAbout,
                                    onLogin = vm::openLogin,
                                    onLogout = vm::logout,
                                )
                            }
                        }
                    }
                }
            }
            is AppRoute.DeviceDetail -> {
                val device = state.devices.firstOrNull { it.id == route.deviceId }
                if (device == null) {
                    vm.navigateBackFromSecondary()
                } else {
                    DeviceDetailScreen(
                        device = device,
                        onBack = vm::navigateBackFromSecondary,
                        onDisconnect = { vm.disconnectDesktop(device.id) },
                        onNewChat = vm::startDesktopConversation,
                    )
                }
            }
            is AppRoute.NewConversation ->
                NewConversationScreen(
                    devices = state.devices,
                    channelIndex = state.newConversationChannelIndex,
                    onChannelChange = vm::setNewConversationChannel,
                    onBack = vm::navigateBackFromSecondary,
                    onStartDesktop = { vm.startDesktopConversation() },
                    onStartCloud = {
                        vm.openCloudConversation()
                    },
                    onConnectDesktop = { vm.selectMainTab(MainTab.Discover) },
                )
            is AppRoute.Chat -> {
                val selected =
                    state.models.firstOrNull { it.id == state.selectedModelId }
                        ?: state.models.firstOrNull()
                val session = sessions.firstOrNull { it.id == state.currentSessionId }
                val title =
                    route.title.ifBlank {
                        when {
                            session != null -> sessionTitle(session.title)
                            route.surface == ChatSurface.Cloud -> stringResource(Res.string.channel_cloud)
                            else -> stringResource(Res.string.pair_desktop)
                        }
                    }
                ChatScreen(
                    title = title,
                    surface = route.surface,
                    messages = state.messages,
                    draft = state.draft,
                    pendingImages = state.pendingImages,
                    isStreaming = state.isStreaming,
                    streamingStatus = state.streamingStatus,
                    models = state.models,
                    selectedModel = selected,
                    modelPickerOpen = state.modelPickerOpen,
                    globalError = state.globalError,
                    onDraftChange = vm::onDraftChange,
                    onSend = vm::sendMessage,
                    onStop = vm::stopStreaming,
                    onBack = vm::navigateBackFromSecondary,
                    onOpenModelPicker = { vm.setModelPicker(true) },
                    onCloseModelPicker = { vm.setModelPicker(false) },
                    onSelectModel = vm::selectModel,
                    onErrorAction = vm::handleErrorAction,
                    onDismissError = vm::clearGlobalError,
                    onImagesPicked = vm::addPendingImages,
                    onRemovePendingImage = vm::removePendingImage,
                )
            }
            is AppRoute.WorkSession ->
                SessionScreen(
                    sessionId = route.sessionId,
                    state = workState,
                    draft = workDrafts[route.sessionId] ?: PromptDraft(),
                    actions = work,
                    onBack = vm::navigateBackFromSecondary,
                    headerActions = {
                        // New Session in the chat's own project, over the chat so Back returns to it.
                        val id = workState.resolve(route.sessionId)
                        IconButton(
                            onClick = {
                                val cwd = workState.session(id)?.projectCwd?.takeIf { it != workState.conversationCwd }
                                vm.openWorkNewSession(cwd, returnTo = id)
                            },
                            enabled = !workState.isStarting(route.sessionId),
                            modifier = Modifier.testTag("chat.newSession"),
                        ) { Icon(Icons.Outlined.EditNote, contentDescription = stringResource(Res.string.new_session_title)) }
                    },
                )
            AppRoute.WorkSettings ->
                WorkSettingsScreen(
                    state = workState,
                    onPreferences = work::setPreferences,
                    onUnpair = work::unpair,
                    onBack = vm::navigateBackFromSecondary,
                    pairing = {
                        if (state.remoteConnecting) {
                            CircularProgressIndicator(Modifier.padding(12.dp))
                        } else {
                            PairingScannerButton(
                                onScanned = { vm.connectDesktop(it, openDetail = false) },
                                label = stringResource(if (workState.paired) Res.string.work_settings_rescan else Res.string.work_settings_scan),
                            )
                        }
                    },
                )
            is AppRoute.WorkNewSession -> {
                val restored = remember(route) { work.takeFailedStart() }
                NewSessionScreen(
                    state = workState,
                    draft = workDrafts[WorkViewModel.NEW_SESSION_DRAFT] ?: PromptDraft(),
                    onDraftChange = { work.setDraft(WorkViewModel.NEW_SESSION_DRAFT, it) },
                    initialProjectCwd = route.projectCwd,
                    restored = restored,
                    onPrepare = work::prepareNewSession,
                    onStart = { start ->
                        var started = ""
                        work.startSession(start) { vm.returnToNewSession(started, start.projectCwd) }?.let { id ->
                            started = id
                            // The chat takes New Session's place, so Back goes to the list.
                            vm.openWorkSession(id)
                        }
                    },
                    onBack = vm::handleSystemBack,
                    onClearError = work::clearError,
                )
            }
            AppRoute.Plan ->
                PlanScreen(
                    subscription = state.subscription,
                    loggedIn = state.user != null,
                    onBack = vm::navigateBackFromSecondary,
                    onRefresh = vm::refreshCatalog,
                    onLogin = vm::openLogin,
                )
            AppRoute.Settings ->
                SettingsScreen(
                    themeMode = state.themeMode,
                    autoResumeLastSession = state.autoResumeLastSession,
                    motionEnabled = state.motionEnabled,
                    onThemeMode = vm::setThemeMode,
                    onAutoResumeLastSession = vm::setAutoResumeLastSession,
                    onMotionEnabled = vm::setMotionEnabled,
                    onClearLocalData = vm::clearLocalSessions,
                    onOpenAbout = vm::openAbout,
                    onBack = vm::navigateBackFromSecondary,
                    confirmBeforeDelete = state.confirmBeforeDelete,
                    onConfirmBeforeDelete = vm::setConfirmBeforeDelete,
                )
            AppRoute.About ->
                AboutScreen(onBack = vm::navigateBackFromSecondary)
            }
            }
        }
    }
}

