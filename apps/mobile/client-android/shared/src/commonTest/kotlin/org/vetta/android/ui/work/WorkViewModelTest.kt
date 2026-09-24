package org.vetta.android.ui.work

import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import org.vetta.android.data.remote.MemorySessionCache
import org.vetta.android.domain.remote.RemoteSessionState
import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.protocol.RemoteRequestMethod
import org.vetta.android.domain.work.DesktopMirror
import org.vetta.android.domain.work.FakeDesktop
import org.vetta.android.domain.work.MirrorPlatform
import org.vetta.android.domain.work.ModelChoice
import org.vetta.android.domain.work.PromptDraft
import org.vetta.android.domain.work.eventually
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class WorkViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private suspend fun TestScope.paired(): Pair<FakeDesktop, WorkViewModel> {
        val desktop = FakeDesktop(backgroundScope)
        desktop.handler = { request ->
            when (request.method) {
                RemoteRequestMethod.SessionList ->
                    respond(
                        request.requestId,
                        buildJsonObject {
                            putJsonArray("sessions") {
                                add(
                                    buildJsonObject {
                                        put("id", "s1")
                                        put("projectCwd", "/conv")
                                        put("title", "周报")
                                        put("updatedAt", 1)
                                        put("status", "idle")
                                    },
                                )
                            }
                        },
                    )
                RemoteRequestMethod.SessionConfigure ->
                    respond(request.requestId, buildJsonObject { putJsonObject("state") { put("status", "idle") } })
                else -> respond(request.requestId, buildJsonObject {})
            }
        }
        val mirror =
            DesktopMirror(
                MirrorPlatform(MapSettings(), MapSettings(), MemorySessionCache(), desktop.createTransport, "Pixel", { testScheduler.currentTime }),
                backgroundScope,
            ).also { it.start() }
        assertTrue(mirror.pairWithCode(desktop.invite()))
        assertTrue(eventually { mirror.state.value.sessions.isNotEmpty() })
        return desktop to WorkViewModel(mirror)
    }

    private fun configures(desktop: FakeDesktop): List<JsonObject> =
        desktop.requests.filter { it.method == RemoteRequestMethod.SessionConfigure }.map { it.payload as JsonObject }

    @Test
    fun configureSendsOnlyWhatChanged() =
        runTest(dispatcher) {
            val (desktop, vm) = paired()
            val current = RemoteSessionState(RemoteSessionStatus.Idle, modelKey = "zai/glm-5", thinkingLevel = "high")

            vm.configure("s1", ModelChoice("zai/glm-5", "high"), current)
            assertTrue(eventually { true })
            assertTrue(configures(desktop).isEmpty(), "picking what is already set sends nothing")

            vm.configure("s1", ModelChoice("zai/glm-5", "max"), current)
            assertTrue(eventually { configures(desktop).size == 1 })
            assertEquals(setOf("thinkingLevel"), configures(desktop)[0].keys, "only the level changed")

            vm.configure("s1", ModelChoice("anthropic/fable", "high"), current)
            assertTrue(eventually { configures(desktop).size == 2 })
            val switched = configures(desktop)[1]
            assertEquals("anthropic/fable", switched["modelKey"]?.jsonPrimitive?.content)
            assertEquals("high", switched["thinkingLevel"]?.jsonPrimitive?.content, "a new model keeps the level the sheet showed")
        }

    @Test
    fun keepsADraftPerSessionAndPutsBackOneThatFailedToSend() =
        runTest(dispatcher) {
            val (desktop, vm) = paired()
            vm.setDraft("s1", PromptDraft("写周报"))
            vm.setDraft("s2", PromptDraft("另一个"))
            assertEquals("写周报", vm.drafts.value["s1"]?.text)
            assertEquals("另一个", vm.drafts.value["s2"]?.text)
            vm.setDraft("s2", PromptDraft(" "))
            assertEquals(" ", vm.drafts.value["s2"]?.text, "spaces being typed stay in the field")

            vm.send("s1", PromptDraft("写周报"))
            assertNull(vm.drafts.value["s1"], "the composer clears once the prompt is on its way")
            assertTrue(eventually { desktop.requests.any { it.method == RemoteRequestMethod.SessionPrompt } })

            desktop.reachable = false
            desktop.dropConnections()
            assertTrue(eventually { !vm.state.value.online })
            vm.send("s1", PromptDraft("断线时发的"))
            assertTrue(eventually { vm.drafts.value["s1"]?.text == "断线时发的" }, "a failed send is not lost")
            assertTrue(eventually { vm.state.value.lastError != null })
            vm.clearError()
            assertNull(vm.state.value.lastError)
            assertEquals(1, desktop.requests.count { it.method == RemoteRequestMethod.SessionPrompt })
            assertTrue((desktop.requests.first { it.method == RemoteRequestMethod.SessionPrompt }.payload as JsonObject)["attachments"] !is JsonArray)
        }

    @Test
    fun aStartThatFailsIsKeptOnceForNewSessionToPutBack() =
        runTest(dispatcher) {
            val desktop = FakeDesktop(backgroundScope)
            desktop.reachable = false
            val mirror =
                DesktopMirror(
                    MirrorPlatform(MapSettings(), MapSettings(), MemorySessionCache(), desktop.createTransport, "Pixel", { testScheduler.currentTime }),
                    backgroundScope,
                ).also { it.start() }
            val vm = WorkViewModel(mirror)
            vm.setDraft(WorkViewModel.NEW_SESSION_DRAFT, PromptDraft("你好"))
            val start = NewSessionStart(PromptDraft("你好"), "/code/vetta", ModelChoice("zai/glm-5", "max"))
            var failed = false

            val localId = vm.startSession(start) { failed = true }
            assertTrue(localId != null)
            assertNull(vm.drafts.value[WorkViewModel.NEW_SESSION_DRAFT], "New Session's composer clears once the chat opens")
            assertTrue(eventually { failed })
            assertEquals(start, vm.takeFailedStart())
            assertNull(vm.takeFailedStart(), "put back once, not every time New Session opens")
            assertNull(vm.startSession(start.copy(draft = PromptDraft("  "))) {})
        }
}
