package org.vetta.android.ui

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.CreationExtras
import androidx.lifecycle.viewmodel.compose.viewModel
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.app.AppContainer
import org.vetta.android.domain.remote.pairing.PairingPhase
import org.vetta.android.domain.work.PromptDraft
import org.vetta.android.resources.Res
import org.vetta.android.resources.new_session_title
import org.vetta.android.resources.work_settings_rescan
import org.vetta.android.resources.work_settings_scan
import org.vetta.android.resources.work_unpaired_scan
import org.vetta.android.ui.components.VettaInfoDialog
import org.vetta.android.ui.i18n.resolve
import org.vetta.android.ui.navigation.AppRoute
import org.vetta.android.ui.navigation.PlatformBackHandler
import org.vetta.android.ui.navigation.hasInAppBackDestination
import org.vetta.android.ui.remote.PairingScannerButton
import org.vetta.android.ui.theme.VettaTheme
import org.vetta.android.ui.work.NewSessionScreen
import org.vetta.android.ui.work.PairingActions
import org.vetta.android.ui.work.PairingApprovalDialog
import org.vetta.android.ui.work.SessionScreen
import org.vetta.android.ui.work.WorkScreen
import org.vetta.android.ui.work.WorkSettingsScreen
import org.vetta.android.ui.work.WorkViewModel
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
    val vm: AppViewModel = viewModel(factory = remember(container) { AppViewModelFactory(container) })
    val state by vm.state.collectAsState()
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

    LaunchedEffect(pairingInvite) {
        if (pairingInvite != null) {
            vm.handlePairingInvite(pairingInvite)
            onPairingInviteHandled()
        }
    }

    VettaTheme(themeMode = state.themeMode) {
        Box(Modifier.fillMaxSize()) {
            Crossfade(
                targetState = state.route,
                animationSpec = tween(durationMillis = 200),
                label = "app route transition",
            ) { route ->
                when (route) {
                    AppRoute.Work ->
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
                                PairingActions(connecting = state.remoteConnecting, onManual = vm::connectDesktopManually) {
                                    PairingScannerButton(
                                        onScanned = vm::connectDesktop,
                                        label = stringResource(Res.string.work_unpaired_scan),
                                    )
                                }
                            },
                        )
                    is AppRoute.WorkSession ->
                        SessionScreen(
                            sessionId = route.sessionId,
                            state = workState,
                            draft = workDrafts[route.sessionId] ?: PromptDraft(),
                            actions = work,
                            onBack = vm::navigateBack,
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
                            themeMode = state.themeMode,
                            onThemeMode = vm::setThemeMode,
                            onPreferences = work::setPreferences,
                            onUnpair = work::unpair,
                            onBack = vm::navigateBack,
                            viewerUrl = remember(workState.desktop) { container.mirror.viewerUrl() },
                            pairing = {
                                PairingActions(
                                    connecting = state.remoteConnecting,
                                    onManual = vm::connectDesktopManually,
                                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                ) {
                                    PairingScannerButton(
                                        onScanned = vm::connectDesktop,
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
                }
            }
            // Pairing runs from several pages; its approval step and its failure show above all of them.
            (workState.pairing as? PairingPhase.AwaitingApproval)?.let { waiting ->
                PairingApprovalDialog(verificationCode = waiting.verificationCode, onCancel = work::cancelPairing)
            }
            state.pairingError?.let { error ->
                VettaInfoDialog(title = error.title.resolve(), message = error.message.resolve(), onDismiss = vm::clearPairingError)
            }
        }
    }
}
