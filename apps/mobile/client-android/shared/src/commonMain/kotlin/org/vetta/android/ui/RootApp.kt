package org.vetta.android.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.VisibilityThreshold
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.IntOffset
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.CreationExtras
import androidx.lifecycle.viewmodel.compose.viewModel
import org.jetbrains.compose.resources.stringResource
import org.vetta.android.app.AppContainer
import org.vetta.android.domain.work.MirrorState
import org.vetta.android.domain.work.PromptDraft
import org.vetta.android.resources.Res
import org.vetta.android.resources.new_session_title
import org.vetta.android.ui.design.VettaMotion
import org.vetta.android.ui.home.HomeScreen
import org.vetta.android.ui.home.ProjectScreen
import org.vetta.android.ui.home.newSessionEntry
import org.vetta.android.ui.navigation.HomePage
import org.vetta.android.ui.navigation.PlatformBackHandler
import org.vetta.android.ui.navigation.Slot
import org.vetta.android.ui.pairing.PairingSheet
import org.vetta.android.ui.pairing.UnpairedView
import org.vetta.android.ui.settings.SettingsScreen
import org.vetta.android.ui.shell.HomeDrawer
import org.vetta.android.ui.theme.VettaTheme
import org.vetta.android.ui.theme.vettaExtra
import org.vetta.android.ui.work.NewSessionScreen
import org.vetta.android.ui.work.SessionScreen
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

    // A back swipe drags the drawer only where Back moves it: open from a chat, shut from Home's first page.
    var backProgress by remember { mutableStateOf<Float?>(null) }
    val backMovesDrawer = (state.drawerOpen && state.homePath.isEmpty()) || (!state.drawerOpen && state.slot is Slot.Session)
    PlatformBackHandler(
        enabled = state.backEnabled,
        onProgress = { if (backMovesDrawer) backProgress = it },
        onCancel = { backProgress = null },
        onBack = {
            backProgress = null
            vm.handleBack()
        },
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

    // The chat in the slot was deleted, here or on the desktop.
    val sessionIds = workState.sessions.map { it.id }
    var knownIds by remember { mutableStateOf(sessionIds) }
    LaunchedEffect(sessionIds) {
        val slotted = (state.slot as? Slot.Session)?.let { workState.resolve(it.sessionId) }
        if (slotted != null && slotted in knownIds && slotted !in sessionIds) vm.startNewSession()
        knownIds = sessionIds
    }

    VettaTheme(themeMode = state.themeMode) {
        Box(Modifier.fillMaxSize().background(MaterialTheme.vettaExtra.pageBackground)) {
            HomeDrawer(
                open = state.drawerOpen,
                enabled = workState.paired,
                onOpenChange = { if (it) vm.openDrawer() else vm.closeDrawer() },
                closableByDrag = state.homePath.isEmpty(),
                backProgress = backProgress,
                content = { SlotContent(state.slot, workState, vm, work) },
                drawer = { HomeStack(state, workState, vm, work, container) },
            )
            if (state.showPairing) {
                PairingSheet(
                    phase = workState.pairing,
                    connecting = state.remoteConnecting,
                    error = state.pairingError,
                    onScanned = vm::connectDesktop,
                    onManual = vm::connectDesktopManually,
                    onCancelPairing = work::cancelPairing,
                    onDismiss = vm::closePairing,
                )
            }
        }
    }
}

/** The root slot: one session, or New Session; until a desktop is paired, how to pair. */
@Composable
private fun SlotContent(slot: Slot, workState: MirrorState, vm: AppViewModel, work: WorkViewModel) {
    val drafts by work.drafts.collectAsState()
    // A new slot starts fresh; the change happens at once, under the drawer as it slides away.
    key(slot) {
        when (slot) {
            is Slot.NewSession ->
                if (!workState.paired) {
                    if (workState.ready) UnpairedView(onPair = vm::openPairing)
                } else {
                    val restored = remember { work.takeFailedStart() }
                    NewSessionScreen(
                        state = workState,
                        draft = drafts[WorkViewModel.NEW_SESSION_DRAFT] ?: PromptDraft(),
                        onDraftChange = { work.setDraft(WorkViewModel.NEW_SESSION_DRAFT, it) },
                        initialProjectCwd = slot.projectCwd,
                        restored = restored,
                        onPrepare = work::prepareNewSession,
                        onStart = { start ->
                            var started = ""
                            work.startSession(start) { vm.returnToNewSession(started, start.projectCwd) }?.let { id ->
                                started = id
                                vm.show(id)
                            }
                        },
                        onOpenHome = vm::openDrawer,
                        onClearError = work::clearError,
                    )
                }
            is Slot.Session ->
                SessionScreen(
                    sessionId = slot.sessionId,
                    state = workState,
                    draft = drafts[slot.sessionId] ?: PromptDraft(),
                    actions = work,
                    onOpenHome = vm::openDrawer,
                    headerActions = {
                        // New Session in the chat's own project.
                        val id = workState.resolve(slot.sessionId)
                        IconButton(
                            onClick = { vm.startNewSession(workState.session(id)?.projectCwd?.takeIf { it != workState.conversationCwd }) },
                            enabled = !workState.isStarting(slot.sessionId),
                            modifier = Modifier.testTag("chat.newSession"),
                        ) { Icon(Icons.Outlined.EditNote, contentDescription = stringResource(Res.string.new_session_title)) }
                    },
                )
        }
    }
}

/** Home and the pages pushed over it, sliding in from the right as a navigation stack does. */
@Composable
private fun HomeStack(state: AppUiState, workState: MirrorState, vm: AppViewModel, work: WorkViewModel, container: AppContainer) {
    val filter by work.filter.collectAsState()
    AnimatedContent(
        targetState = state.homePath,
        contentKey = { path -> path.size to path.lastOrNull() },
        transitionSpec = {
            val spring = VettaMotion.snappy(IntOffset.VisibilityThreshold)
            if (targetState.size >= initialState.size) {
                (slideInHorizontally(spring) { it } + fadeIn(VettaMotion.snappy())) togetherWith
                    (slideOutHorizontally(spring) { -it / 4 } + fadeOut(VettaMotion.snappy()))
            } else {
                (slideInHorizontally(spring) { -it / 4 } + fadeIn(VettaMotion.snappy())) togetherWith
                    (slideOutHorizontally(spring) { it } + fadeOut(VettaMotion.snappy()))
            }
        },
        label = "home stack",
    ) { path ->
        when (val page = path.lastOrNull()) {
            null ->
                HomeScreen(
                    state = workState,
                    filter = filter,
                    onFilterChange = work::setFilter,
                    actions = work,
                    entries = listOf(newSessionEntry { vm.startNewSession() }),
                    onClose = vm::closeDrawer,
                    onOpenSession = vm::show,
                    onOpenProject = { vm.push(HomePage.Project(it)) },
                    onOpenSettings = { vm.push(HomePage.Settings) },
                    onRefresh = work::refresh,
                    onRefreshProjects = work::refreshProjects,
                    onReconnect = work::reconnect,
                    onPair = vm::openPairing,
                )
            is HomePage.Project ->
                ProjectScreen(
                    cwd = page.cwd,
                    state = workState,
                    actions = work,
                    onBack = vm::pop,
                    onOpenSession = vm::show,
                    onNewSession = { vm.startNewSession(page.cwd) },
                    onRefresh = work::refresh,
                )
            HomePage.Settings ->
                SettingsScreen(
                    state = workState,
                    themeMode = state.themeMode,
                    onThemeMode = vm::setThemeMode,
                    onPreferences = work::setPreferences,
                    onUnpair = work::unpair,
                    onPair = vm::openPairing,
                    onBack = vm::pop,
                    viewerUrl = remember(workState.desktop) { container.mirror.viewerUrl() },
                )
        }
    }
}
