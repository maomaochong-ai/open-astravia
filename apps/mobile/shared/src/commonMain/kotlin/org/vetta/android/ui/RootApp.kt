package org.vetta.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModel
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
import org.vetta.android.ui.i18n.Str
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
import kotlin.reflect.KClass

val LocalAppContainer =
    staticCompositionLocalOf<AppContainer> {
        error("AppContainer not provided")
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

    PlatformBackHandler(
        enabled = state.route.hasInAppBackDestination(),
        onBack = vm::handleSystemBack,
    )

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
                                    onOpenSession = { id ->
                                        val item = vm.sessionListItems().firstOrNull { it.id == id }
                                        vm.openChat(
                                            sessionId = id,
                                            surface = if (item?.isCloud == false) ChatSurface.Desktop else ChatSurface.Cloud,
                                            title = item?.title.orEmpty(),
                                        )
                                    },
                                    onNewConversation = { vm.openNewConversation(0) },
                                    onUseCloudAi = vm::openCloudConversation,
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
                                    onOpenSession = { item ->
                                        vm.openChat(
                                            sessionId = item.id,
                                            surface = if (item.isCloud) ChatSurface.Cloud else ChatSurface.Desktop,
                                            title = item.title,
                                        )
                                    },
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
                        onNewChat = { vm.startDesktopConversation(device.id) },
                    )
                }
            }
            is AppRoute.NewConversation ->
                NewConversationScreen(
                    devices = state.devices,
                    channelIndex = state.newConversationChannelIndex,
                    onChannelChange = vm::setNewConversationChannel,
                    onBack = vm::navigateBackFromSecondary,
                    onStartDesktop = { deviceId ->
                        vm.startDesktopConversation(deviceId)
                    },
                    onStartCloud = {
                        vm.openCloudConversation()
                    },
                    onConnectDesktop = { vm.selectMainTab(MainTab.Discover) },
                )
            is AppRoute.Chat -> {
                val selected =
                    state.models.firstOrNull { it.id == state.selectedModelId }
                        ?: state.models.firstOrNull()
                val title =
                    route.title.ifBlank {
                        sessions.firstOrNull { it.id == state.currentSessionId }?.title
                            ?: if (route.surface == ChatSurface.Cloud) Str.channelCloud else Str.pairDesktop
                    }
                ChatScreen(
                    title = title,
                    surface = route.surface,
                    messages = state.messages,
                    draft = state.draft,
                    pendingImages = state.pendingImages,
                    isStreaming = state.isStreaming,
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
