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
import org.vetta.android.core.auth.InMemoryTokenStore
import org.vetta.android.data.session.SettingsSessionStore
import org.vetta.android.ui.navigation.AppRoute
import org.vetta.android.ui.navigation.MainTab
import org.vetta.android.ui.navigation.hasInAppBackDestination
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
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

    @Test
    fun aDesktopSessionOpensOverTheWorkTabAndBackReturnsToIt() =
        runTest(dispatcher) {
            val vm =
                AppViewModel(
                    AppContainer(
                        preferences = AppPreferences(MapSettings()),
                        tokenStore = InMemoryTokenStore(),
                        sessionStore = SettingsSessionStore(MapSettings()),
                        mirror = unpairedMirror(),
                    ),
                )
            advanceUntilIdle()
            vm.skipWelcome()
            vm.selectMainTab(MainTab.Work)

            vm.openWorkSession("s1")
            assertEquals(AppRoute.WorkSession("s1"), vm.state.value.route)
            assertTrue(vm.state.value.route.hasInAppBackDestination())

            vm.handleSystemBack()
            assertEquals(AppRoute.Main(MainTab.Work), vm.state.value.route)
        }
}
