package org.vetta.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
import org.vetta.android.ui.navigation.AppRoute

/** Why a pairing failed, worded for the phone's language. */
data class PairingError(val title: UiText, val message: UiText)

data class AppUiState(
    val route: AppRoute = AppRoute.Work,
    val themeMode: ThemeMode = ThemeMode.Light,
    /** A pairing is under way; the pairing buttons give way to a spinner. */
    val remoteConnecting: Boolean = false,
    val pairingError: PairingError? = null,
)

/** Where the app is, its theme, and pairing with a desktop. */
class AppViewModel(
    private val container: AppContainer,
) : ViewModel() {
    private val _state = MutableStateFlow(AppUiState(themeMode = container.preferences.themeMode.value))
    val state: StateFlow<AppUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            container.preferences.themeMode.collect { mode -> _state.update { it.copy(themeMode = mode) } }
        }
        container.mirror.start()
    }

    fun setThemeMode(mode: ThemeMode) = container.preferences.setThemeMode(mode)

    fun openWorkSession(sessionId: String) = navigate(AppRoute.WorkSession(sessionId))

    fun openWorkSettings() = navigate(AppRoute.WorkSettings)

    fun openWorkNewSession(projectCwd: String? = null, returnTo: String? = null) =
        navigate(AppRoute.WorkNewSession(projectCwd, returnTo))

    /** Back to New Session with what was typed, unless the user already left `sessionId`'s chat. */
    fun returnToNewSession(sessionId: String, projectCwd: String?) {
        if (_state.value.route == AppRoute.WorkSession(sessionId)) navigate(AppRoute.WorkNewSession(projectCwd))
    }

    fun navigateBack() = navigate(AppRoute.Work)

    fun handleSystemBack() {
        when (val route = _state.value.route) {
            AppRoute.Work -> Unit
            is AppRoute.WorkNewSession -> route.returnTo?.let(::openWorkSession) ?: navigateBack()
            else -> navigateBack()
        }
    }

    private fun navigate(route: AppRoute) {
        _state.update { it.copy(route = route) }
    }

    /** A `vetta://pair` link from outside the app: checked before anything goes on the network. */
    fun handlePairingInvite(target: String) {
        if (parsePairingInvite(target) == null) {
            _state.update { it.copy(pairingError = PairingError(uiText(Res.string.invalid_pairing_invite), uiText(Res.string.invalid_pairing_invite_hint))) }
            return
        }
        connectDesktop(target)
    }

    /** Pairs with the desktop in a scanned code. */
    fun connectDesktop(target: String) = pair { container.mirror.pairWithCode(target) }

    /** Pairs with the desktop at a typed `host:port`; the computer shows a code to allow. */
    fun connectDesktopManually(endpoint: String) = pair { container.mirror.pairManually(endpoint) }

    /** One pairing at a time; a failure is reported, a cancelled one is not. */
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
                val failure = (container.mirror.state.value.pairing as? PairingPhase.Failed)?.reason
                if (!paired && failure != null) _state.update { it.copy(pairingError = pairingError(failure)) }
            } finally {
                _state.update { it.copy(remoteConnecting = false) }
            }
        }
    }

    fun clearPairingError() {
        _state.update { it.copy(pairingError = null) }
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
