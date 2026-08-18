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
import org.vetta.android.domain.session.MessageImage
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 驱动真实 [AppViewModel.openChat]：切换会话必须清空 pending 图片，防止串会话发送。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AppViewModelSessionPendingTest {
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
    fun openChatClearsPendingImagesWhenSwitchingSessions() =
        runTest(dispatcher) {
            val container =
                AppContainer(
                    preferences = AppPreferences(MapSettings()),
                    tokenStore = InMemoryTokenStore(),
                    sessionStore = SettingsSessionStore(MapSettings()),
                )
            val vm = AppViewModel(container)
            advanceUntilIdle()
            assertTrue(vm.state.value.bootstrapped)

            val s1 = container.sessionStore.createSession(title = "one")
            val s2 = container.sessionStore.createSession(title = "two")
            vm.openChat(s1.id)
            advanceUntilIdle()
            assertEquals(s1.id, vm.state.value.currentSessionId)

            val img =
                MessageImage(
                    id = "p1",
                    mimeType = "image/png",
                    fileName = "x.png",
                    base64Data = "abc",
                )
            vm.addPendingImages(listOf(img))
            assertEquals(1, vm.state.value.pendingImages.size)

            vm.openChat(s2.id)
            advanceUntilIdle()
            assertEquals(s2.id, vm.state.value.currentSessionId)
            assertTrue(
                vm.state.value.pendingImages.isEmpty(),
                "pending images must not leak into another session",
            )
        }

    @Test
    fun openChatNullClearsPendingImages() =
        runTest(dispatcher) {
            val container =
                AppContainer(
                    preferences = AppPreferences(MapSettings()),
                    tokenStore = InMemoryTokenStore(),
                    sessionStore = SettingsSessionStore(MapSettings()),
                )
            val vm = AppViewModel(container)
            advanceUntilIdle()
            assertTrue(vm.state.value.bootstrapped)

            val s1 = container.sessionStore.createSession()
            vm.openChat(s1.id)
            advanceUntilIdle()
            assertEquals(s1.id, vm.state.value.currentSessionId)
            vm.addPendingImages(
                listOf(
                    MessageImage(id = "p2", mimeType = "image/jpeg", base64Data = "xyz"),
                ),
            )
            assertEquals(1, vm.state.value.pendingImages.size)

            vm.openChat(null)
            advanceUntilIdle()
            assertEquals(null, vm.state.value.currentSessionId)
            assertTrue(vm.state.value.pendingImages.isEmpty())
        }
}
