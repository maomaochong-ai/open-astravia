package org.vetta.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.vetta.android.app.AppContainer
import org.vetta.android.app.ThemeMode
import org.vetta.android.domain.remote.pairing.PairingFailure
import org.vetta.android.domain.remote.pairing.PairingPhase
import org.vetta.android.domain.remote.parsePairingInvite
import org.vetta.android.resources.Res
import org.vetta.android.resources.invalid_pairing_invite
import org.vetta.android.resources.invalid_pairing_invite_hint
import org.vetta.android.resources.pair_failed_rejected
import org.vetta.android.resources.pair_failed_unauthorized
import org.vetta.android.resources.pair_failed_unreachable
import org.vetta.android.resources.pair_manual_invalid
import org.vetta.android.resources.remote_connect_failed
import org.vetta.android.ui.i18n.UiText
import org.vetta.android.ui.i18n.uiText
import org.vetta.android.ui.navigation.HomePage
import org.vetta.android.ui.navigation.Slot

/** Why a pairing failed, worded for the phone's language. */
data class PairingError(val title: UiText, val message: UiText)

/**
 * Navigation as the iPhone app's `Router` has it: one session in the root slot, and
 * Home as a drawer over it with its own stack of pages, kept while the drawer is shut
 * so it reopens where it was left. Pairing is a sheet over whatever is showing.
 */
data class AppUiState(
    val slot: Slot = Slot.NewSession(),
    val drawerOpen: Boolean = false,
    val homePath: List<HomePage> = emptyList(),
    val showPairing: Boolean = false,
    /** The task board, a sheet over whatever is showing. */
    val showBoard: Boolean = false,
    /** The computer's screen, full size over everything. */
    val showRemote: Boolean = false,
    val themeMode: ThemeMode = ThemeMode.Light,
    /** Keeping the desktop link up in the background to notify about sessions. */
    val backgroundLink: Boolean = false,
    /** A pairing is under way. */
    val remoteConnecting: Boolean = false,
    /** Why the last pairing failed, shown on the pairing sheet until the next attempt. */
    val pairingError: PairingError? = null,
) {
    /** Whether Back has somewhere to go inside the app; otherwise it leaves. */
    val backEnabled: Boolean
        get() = showRemote || drawerOpen || slot is Slot.Session

    /** The same while Home stays beside the slot, where only its pages and the remote screen go back. */
    val backEnabledBeside: Boolean
        get() = showRemote || homePath.isNotEmpty()
}

class AppViewModel(
    private val container: AppContainer,
) : ViewModel() {
    private val _state = MutableStateFlow(AppUiState(themeMode = container.preferences.themeMode.value))
    val state: StateFlow<AppUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            container.preferences.themeMode.collect { mode -> _state.update { it.copy(themeMode = mode) } }
        }
        viewModelScope.launch {
            container.preferences.backgroundLink.collect { on -> _state.update { it.copy(backgroundLink = on) } }
        }
        // Nothing left to show (never paired): back to the start. An unpairing keeps the
        // sessions readable, so the screen the user is on stays.
        viewModelScope.launch {
            container.mirror.state.map { it.paired || it.unlinked != null }.distinctUntilChanged().collect { shown -> if (!shown) reset() }
        }
        container.mirror.start()
    }

    fun setThemeMode(mode: ThemeMode) = container.preferences.setThemeMode(mode)

    fun setBackgroundLink(enabled: Boolean) = container.preferences.setBackgroundLink(enabled)

    // Drawer and slot

    fun openDrawer() = _state.update { it.copy(drawerOpen = true) }

    fun closeDrawer() = _state.update { it.copy(drawerOpen = false) }

    /** A blank New Session in the slot, starting in `projectCwd`. */
    fun startNewSession(projectCwd: String? = null) = fill(Slot.NewSession(projectCwd))

    /** Puts `sessionId`'s chat in the slot. */
    fun show(sessionId: String) = fill(Slot.Session(sessionId))

    /** Back to New Session with what was typed, unless the user already left `sessionId`'s chat. */
    fun returnToNewSession(sessionId: String, projectCwd: String?) {
        if (_state.value.slot == Slot.Session(sessionId)) _state.update { it.copy(slot = Slot.NewSession(projectCwd)) }
    }

    /** The slot changes at once, under the drawer as it slides away; the board makes way too. */
    private fun fill(next: Slot) = _state.update { it.copy(slot = next, drawerOpen = false, showBoard = false) }

    fun openBoard() = _state.update { it.copy(showBoard = true) }

    fun openRemote() = _state.update { it.copy(showRemote = true) }

    fun closeRemote() = _state.update { it.copy(showRemote = false) }

    fun closeBoard() = _state.update { it.copy(showBoard = false) }

    /** From the board to Home's whole list. */
    fun showAllSessions() = _state.update { it.copy(showBoard = false, homePath = emptyList(), drawerOpen = true) }

    fun push(page: HomePage) = _state.update { it.copy(homePath = it.homePath + page, drawerOpen = true) }

    fun pop() = _state.update { it.copy(homePath = it.homePath.dropLast(1)) }

    /**
     * Back walks Home's pages, then shuts the drawer; from a chat it opens Home, the
     * chat's parent. From Home's first page and from New Session it leaves the app.
     */
    fun handleBack(beside: Boolean = false) {
        val state = _state.value
        if (beside) {
            // Home is not a drawer then: Back only closes what is over it.
            if (state.showRemote) closeRemote() else if (state.homePath.isNotEmpty()) pop()
            return
        }
        when {
            state.showRemote -> closeRemote()
            state.drawerOpen && state.homePath.isNotEmpty() -> pop()
            state.drawerOpen -> closeDrawer()
            state.slot is Slot.Session -> openDrawer()
        }
    }

    private fun reset() =
        _state.update { it.copy(slot = Slot.NewSession(), homePath = emptyList(), drawerOpen = false, showBoard = false, showRemote = false) }

    // Pairing

    fun openPairing() = _state.update { it.copy(showPairing = true, pairingError = null) }

    /** Closing the sheet stops a pairing still under way. */
    fun closePairing() {
        container.mirror.cancelPairing()
        _state.update { it.copy(showPairing = false, pairingError = null) }
    }

    /** A `vetta://pair` link from outside the app: checked before anything goes on the network. */
    fun handlePairingInvite(target: String) {
        _state.update { it.copy(showPairing = true) }
        if (parsePairingInvite(target) == null) {
            _state.update { it.copy(pairingError = pairingError(PairingFailure.InvalidCode)) }
            return
        }
        connectDesktop(target)
    }

    /** Pairs with the desktop in a scanned code. */
    fun connectDesktop(target: String) = pair { container.mirror.pairWithCode(target) }

    /** Pairs with the desktop at a typed `host:port`; the computer shows a code to allow. */
    fun connectDesktopManually(endpoint: String) = pair { container.mirror.pairManually(endpoint) }

    /** One pairing at a time; success closes the sheet, a failure says why, a cancelled one says nothing. */
    private fun pair(connect: suspend () -> Boolean) {
        if (_state.value.remoteConnecting) return
        _state.update { it.copy(remoteConnecting = true, pairingError = null) }
        viewModelScope.launch {
            try {
                val paired =
                    try {
                        connect()
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Throwable) {
                        _state.update { it.copy(pairingError = pairingError(PairingFailure.Unreachable)) }
                        return@launch
                    }
                if (paired) {
                    container.mirror.refreshLink()
                    _state.update { it.copy(showPairing = false) }
                } else {
                    val failure = (container.mirror.state.value.pairing as? PairingPhase.Failed)?.reason
                    if (failure != null) _state.update { it.copy(pairingError = pairingError(failure)) }
                }
            } finally {
                _state.update { it.copy(remoteConnecting = false) }
            }
        }
    }

    companion object {
        fun pairingError(reason: PairingFailure): PairingError =
            if (reason == PairingFailure.InvalidCode) {
                PairingError(uiText(Res.string.invalid_pairing_invite), uiText(Res.string.invalid_pairing_invite_hint))
            } else {
                val message =
                    when (reason) {
                        PairingFailure.Rejected -> Res.string.pair_failed_rejected
                        PairingFailure.Unauthorized -> Res.string.pair_failed_unauthorized
                        PairingFailure.InvalidEndpoint -> Res.string.pair_manual_invalid
                        else -> Res.string.pair_failed_unreachable
                    }
                PairingError(uiText(Res.string.remote_connect_failed), uiText(message))
            }
    }
}
