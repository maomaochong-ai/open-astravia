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
import org.vetta.android.domain.remote.pairing.PairingFailure
import org.vetta.android.resources.Res
import org.vetta.android.resources.invalid_pairing_invite
import org.vetta.android.resources.pair_failed_rejected
import org.vetta.android.ui.i18n.UiText
import org.vetta.android.ui.navigation.HomePage
import org.vetta.android.ui.navigation.Slot
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
    fun theAppOpensOnNewSessionWhereBackLeaves() =
        runTest(dispatcher) {
            val vm = viewModel()
            advanceUntilIdle()
            assertEquals(Slot.NewSession(), vm.state.value.slot)
            assertFalse(vm.state.value.drawerOpen)
            assertFalse(vm.state.value.backEnabled)
        }

    @Test
    fun openingASessionFillsTheSlotAndPutsHomeAway() =
        runTest(dispatcher) {
            val vm = viewModel()
            advanceUntilIdle()
            vm.openDrawer()
            vm.show("s1")
            assertEquals(Slot.Session("s1"), vm.state.value.slot)
            assertFalse(vm.state.value.drawerOpen)
        }

    @Test
    fun backFromAChatOpensHomeThenShutsIt() =
        runTest(dispatcher) {
            val vm = viewModel()
            advanceUntilIdle()
            vm.show("s1")
            assertTrue(vm.state.value.backEnabled)

            vm.handleBack()
            assertTrue(vm.state.value.drawerOpen, "Home is the chat's parent")
            vm.handleBack()
            assertFalse(vm.state.value.drawerOpen)
            assertEquals(Slot.Session("s1"), vm.state.value.slot, "the chat is still there under Home")
        }

    @Test
    fun homesPagesStackAndBackWalksThemBeforeShuttingHome() =
        runTest(dispatcher) {
            val vm = viewModel()
            advanceUntilIdle()
            vm.push(HomePage.Project("/code/app"))
            vm.push(HomePage.Settings)
            assertTrue(vm.state.value.drawerOpen)
            assertEquals(listOf(HomePage.Project("/code/app"), HomePage.Settings), vm.state.value.homePath)

            vm.handleBack()
            assertEquals(listOf<HomePage>(HomePage.Project("/code/app")), vm.state.value.homePath)
            vm.closeDrawer()
            assertEquals(listOf<HomePage>(HomePage.Project("/code/app")), vm.state.value.homePath, "Home reopens where it was left")
        }

    @Test
    fun newSessionInAProjectAndAFailedStartReturnsToNewSession() =
        runTest(dispatcher) {
            val vm = viewModel()
            advanceUntilIdle()
            vm.startNewSession("/code/vetta")
            assertEquals(Slot.NewSession("/code/vetta"), vm.state.value.slot)

            vm.show("local-1")
            vm.returnToNewSession("local-1", "/code/vetta")
            assertEquals(Slot.NewSession("/code/vetta"), vm.state.value.slot)

            vm.show("s2")
            vm.returnToNewSession("local-1", null)
            assertEquals(Slot.Session("s2"), vm.state.value.slot, "a user who already left that chat stays where they are")
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
    fun anInvalidPairingLinkOpensPairingWithTheReasonAndNoNetworkAccess() =
        runTest(dispatcher) {
            val vm = viewModel()
            advanceUntilIdle()
            vm.handlePairingInvite("vetta://pair?nonsense")
            advanceUntilIdle()
            assertTrue(vm.state.value.showPairing)
            assertEquals(UiText.Resource(Res.string.invalid_pairing_invite), vm.state.value.pairingError?.title)
            assertFalse(vm.state.value.remoteConnecting)

            vm.closePairing()
            assertFalse(vm.state.value.showPairing)
            assertEquals(null, vm.state.value.pairingError, "the next attempt starts clean")
        }

    @Test
    fun pairingFailuresAreWordedByTheirReason() {
        assertEquals(UiText.Resource(Res.string.pair_failed_rejected), AppViewModel.pairingError(PairingFailure.Rejected).message)
        assertEquals(UiText.Resource(Res.string.invalid_pairing_invite), AppViewModel.pairingError(PairingFailure.InvalidCode).title)
    }
}
