package org.vetta.android.ui

import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.vetta.android.app.AppContainer
import org.vetta.android.app.AppPreferences
import org.vetta.android.app.ThemeMode
import org.vetta.android.resources.Res
import org.vetta.android.resources.invalid_pairing_invite
import org.vetta.android.resources.pair_failed_rejected
import org.vetta.android.domain.remote.pairing.PairingFailure
import org.vetta.android.ui.i18n.UiText
import org.vetta.android.ui.navigation.AppRoute
import org.vetta.android.ui.navigation.hasInAppBackDestination
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class AppViewModelWorkTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel(preferences: AppPreferences = AppPreferences(MapSettings())) =
        AppViewModel(AppContainer(preferences = preferences, mirror = unpairedMirror()))

    @Test
    fun theAppOpensOnTheDesktopsSessionsWhereBackEnds() =
        runTest(dispatcher) {
            val vm = viewModel()
            advanceUntilIdle()
            assertEquals(AppRoute.Work, vm.state.value.route)
            assertFalse(vm.state.value.route.hasInAppBackDestination())

            vm.openWorkSession("s1")
            assertTrue(vm.state.value.route.hasInAppBackDestination())
            vm.handleSystemBack()
            assertEquals(AppRoute.Work, vm.state.value.route)
        }

    @Test
    fun newSessionFromAChatReturnsToItAndAFailedStartReturnsToNewSession() =
        runTest(dispatcher) {
            val vm = viewModel()
            advanceUntilIdle()

            vm.openWorkSession("s1")
            vm.openWorkNewSession("/code/vetta", returnTo = "s1")
            vm.handleSystemBack()
            assertEquals(AppRoute.WorkSession("s1"), vm.state.value.route, "Back from New Session returns to the chat it came from")

            vm.openWorkNewSession()
            vm.handleSystemBack()
            assertEquals(AppRoute.Work, vm.state.value.route)

            vm.openWorkSession("local-1")
            vm.returnToNewSession("local-1", "/code/vetta")
            assertEquals(AppRoute.WorkNewSession("/code/vetta"), vm.state.value.route)

            vm.openWorkSession("s2")
            vm.returnToNewSession("local-1", null)
            assertEquals(AppRoute.WorkSession("s2"), vm.state.value.route, "a user who already left that chat stays where they are")
        }

    @Test
    fun theThemeChoiceIsKept() =
        runTest(dispatcher) {
            val preferences = AppPreferences(MapSettings())
            val vm = viewModel(preferences)
            vm.setThemeMode(ThemeMode.Dark)
            advanceUntilIdle()
            assertEquals(ThemeMode.Dark, vm.state.value.themeMode)
            assertEquals(ThemeMode.Dark, preferences.themeMode.value)
        }

    @Test
    fun anInvalidPairingLinkIsRejectedBeforeAnyNetworkAccess() =
        runTest(dispatcher) {
            val vm = viewModel()
            advanceUntilIdle()
            vm.handlePairingInvite("vetta://pair?nonsense")
            advanceUntilIdle()
            assertEquals(UiText.Resource(Res.string.invalid_pairing_invite), vm.state.value.pairingError?.title)
            assertFalse(vm.state.value.remoteConnecting)
            vm.clearPairingError()
            assertEquals(null, vm.state.value.pairingError)
        }

    @Test
    fun pairingFailuresAreWordedByTheirReason() {
        assertEquals(UiText.Resource(Res.string.pair_failed_rejected), AppViewModel.pairingError(PairingFailure.Rejected).message)
        assertEquals(UiText.Resource(Res.string.invalid_pairing_invite), AppViewModel.pairingError(PairingFailure.InvalidCode).title)
    }
}
