package org.vetta.android.domain.remote

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RemoteApiTest {
    private fun json(text: String): JsonElement = Json.parseToJsonElement(text)

    @Test
    fun readsSessionSummariesAndSkipsMalformedEntries() {
        val sessions =
            RemoteApi.readSessionSummaries(
                json(
                    """
                    {"sessions":[
                      {"id":"s1","projectCwd":"/code/app","projectName":"app","title":"Fix build","preview":"ok",
                       "updatedAt":1700000000000,"status":"waiting_input","live":true,"pinnedAt":1700000000500},
                      {"id":"","projectCwd":"/x"},
                      {"id":"s2","projectCwd":"/conv","status":"unknown","extra":1},
                      "garbage"
                    ]}
                    """,
                ),
            )
        assertEquals(listOf("s1", "s2"), sessions.map { it.id })
        val first = sessions[0]
        assertEquals(RemoteSessionStatus.WaitingInput, first.status)
        assertTrue(first.live)
        assertEquals(1_700_000_000_500, first.pinnedAt)
        // A missing name falls back to the path, an unknown status to idle.
        assertEquals("/conv", sessions[1].projectName)
        assertEquals(RemoteSessionStatus.Idle, sessions[1].status)
        assertNull(sessions[1].pinnedAt)
    }

    @Test
    fun readsSessionStateWithItsQuestionAndError() {
        val state =
            RemoteApi.readSessionState(
                json(
                    """
                    {"status":"error","model":"GLM","modelKey":"zai/glm","thinkingLevel":"high","contextPercent":42.5,
                     "error":{"message":"boom"},
                     "pendingQuestion":{"requestId":"q1","questions":[
                        {"question":"继续？","header":"确认","multiSelect":true,"options":[{"label":"是"},{"label":""}]},
                        {"header":"no question"}
                     ]}}
                    """,
                ),
            )
        assertEquals(RemoteSessionStatus.Error, state.status)
        assertEquals("zai/glm", state.modelKey)
        assertEquals(42.5, state.contextPercent)
        assertEquals(RemoteSessionError("internal_error", "boom"), state.error)
        val question = state.pendingQuestion!!.questions.single()
        assertTrue(question.multiSelect)
        assertEquals(listOf(RemoteQuestionOption("是", "")), question.options)
        assertEquals(RemoteSessionStatus.Idle, RemoteApi.readSessionState(null).status)
    }

    @Test
    fun readsMessageToolAndHistoryEvents() {
        assertEquals(RemoteMessageEvent.User("hi", 7), RemoteApi.readMessageEvent(json("""{"kind":"user","text":"hi"}""")) { 7 })
        assertEquals(RemoteMessageEvent.AssistantDelta("a"), RemoteApi.readMessageEvent(json("""{"kind":"assistant_delta","text":"a"}""")) { 0 })
        assertEquals(RemoteMessageEvent.TurnEnd(5), RemoteApi.readMessageEvent(json("""{"kind":"turn_end","at":5}""")) { 0 })
        assertNull(RemoteApi.readMessageEvent(json("""{"kind":"other"}""")) { 0 })

        assertEquals(
            RemoteToolEvent("t1", "bash", RemoteToolPhase.Completed, args = "{}", result = "ok", durationMs = 3.0),
            RemoteApi.readToolEvent(json("""{"toolCallId":"t1","toolName":"bash","phase":"completed","args":"{}","result":"ok","durationMs":3}""")),
        )
        assertNull(RemoteApi.readToolEvent(json("""{"toolCallId":"t1","toolName":"bash","phase":"exploded"}""")))

        val entries =
            RemoteApi.readTranscriptEntries(
                json(
                    """
                    {"entries":[
                      {"id":"u1","kind":"user","text":"hi","at":1},
                      {"id":"a1","kind":"assistant","text":"ok","toolCalls":[{"toolCallId":"t1","toolName":"read","isError":true},{"toolName":"x"}]},
                      {"id":"m1","kind":"marker","text":"compacted"},
                      {"id":"z","kind":"unknown"}
                    ]}
                    """,
                ),
            )
        assertEquals(listOf("u1", "a1", "m1"), entries.map { it.id })
        assertEquals(listOf(RemoteToolCallSummary("t1", "read", isError = true)), (entries[1] as RemoteTranscriptEntry.Assistant).toolCalls)
    }

    @Test
    fun readsProjectsModelsAndDeviceStatus() {
        val projects =
            RemoteApi.readProjectSummaries(
                json("""{"projects":[{"cwd":"/conv","name":"Conversations","kind":"conversation","sessionCount":3},{"cwd":"/code/app","kind":"weird"}]}"""),
            )
        assertEquals(listOf(true, false), projects.map { it.isConversation })
        assertEquals("/code/app", projects[1].name)

        val models =
            RemoteApi.readModelOptions(
                json("""{"models":[{"key":"zai/glm","thinkingLevels":["none","","max"],"supportsImage":true},{"name":"no key"}]}"""),
            )
        assertEquals(listOf(RemoteModelOption("zai/glm", "zai/glm", "zai", listOf("none", "max"), null, true)), models)

        val status = RemoteApi.readDeviceStatus(json("""{"deviceName":"Mac","lanEndpoints":["10.0.0.2:7300",5],"relayEnabled":true,"runningSessionCount":2}"""))
        assertEquals(RemoteDeviceStatus("Mac", null, listOf("10.0.0.2:7300"), true, 2), status)
        assertNull(RemoteApi.readDeviceStatus(json("""{"deviceName":""}""")))
    }
}
