package org.vetta.android.domain.work

import com.russhwolf.settings.MapSettings
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import org.vetta.android.data.remote.MemorySessionCache
import org.vetta.android.domain.remote.AttachmentKind
import org.vetta.android.domain.remote.RemoteInputState
import org.vetta.android.domain.remote.RemoteQuestionAnswer
import org.vetta.android.domain.remote.RemoteSessionStatus
import org.vetta.android.domain.remote.TranscriptAttachment
import org.vetta.android.domain.remote.TranscriptItem
import org.vetta.android.domain.remote.link.DesktopLink
import org.vetta.android.domain.remote.pairing.PairingStore
import org.vetta.android.domain.remote.pairing.SettingsSecretStore
import org.vetta.android.domain.remote.protocol.RemoteCrypto
import org.vetta.android.domain.remote.protocol.RemoteErrorCode
import org.vetta.android.domain.remote.protocol.RemoteEventName
import org.vetta.android.domain.remote.protocol.RemoteRequestMethod
import kotlinx.coroutines.CompletableDeferred

/**
 * End to end over the fake desktop: pairing, the session list, prompting with
 * streamed replies, answering a question, and what survives a relaunch.
 */
class DesktopMirrorTest {
    private class Device(
        val settings: MapSettings = MapSettings(),
        val secrets: MapSettings = MapSettings(),
        val cache: MemorySessionCache = MemorySessionCache(),
        var turnEnds: Int = 0,
    )

    private fun TestScope.mirror(desktop: FakeDesktop, device: Device = Device(), legacyIdentity: String? = null): DesktopMirror =
        DesktopMirror(
            MirrorPlatform(
                settings = device.settings,
                secrets = SettingsSecretStore(device.secrets),
                cache = device.cache,
                createTransport = desktop.createTransport,
                deviceName = "Pixel",
                now = { testScheduler.currentTime },
                onTurnEnd = { device.turnEnds += 1 },
                legacyIdentitySecret = legacyIdentity,
            ),
            backgroundScope,
        ).also { it.start() }

    private fun session(id: String, title: String, updatedAt: Long, cwd: String = "/conv", live: Boolean = false): JsonObject =
        buildJsonObject {
            put("id", id)
            put("projectCwd", cwd)
            put("projectName", if (cwd == "/conv") "对话" else "vetta")
            put("title", title)
            put("preview", "上周的")
            put("updatedAt", updatedAt)
            put("status", "completed")
            put("live", live)
        }

    /** Answers like the real desktop for the requests these tests make. */
    private fun TestScope.scriptedDesktop(moreSessions: List<JsonObject> = emptyList()): FakeDesktop {
        val desktop = FakeDesktop(backgroundScope)
        val sessions = (listOf(session("s1", "整理周报", 1_000)) + moreSessions).toMutableList()
        var uploads = 0
        var modelKey = "anthropic/claude-fable-5-1"
        var thinkingLevel = "off"
        desktop.handler = { request ->
            val payload = request.payload as? JsonObject
            val sid = request.sessionId
            when (request.method) {
                RemoteRequestMethod.SessionUpload -> {
                    uploads += 1
                    respond(request.requestId, buildJsonObject { put("uploadId", "up-$uploads") })
                }
                RemoteRequestMethod.ModelList ->
                    if (sid == "old-desktop") {
                        fail(request.requestId, RemoteErrorCode.InvalidFrame, "unknown method")
                    } else {
                        respond(
                            request.requestId,
                            buildJsonObject {
                                putJsonArray("models") {
                                    add(model("anthropic/claude-fable-5-1", "Claude Fable 5.1", "anthropic", listOf("off", "low", "medium", "high")))
                                    add(model("zai/glm-5", "GLM 5", "zai", listOf("none", "high", "max")))
                                }
                            },
                        )
                    }
                RemoteRequestMethod.SessionConfigure -> {
                    modelKey = payload?.get("modelKey")?.jsonPrimitive?.content ?: modelKey
                    thinkingLevel = payload?.get("thinkingLevel")?.jsonPrimitive?.content ?: thinkingLevel
                    respond(
                        request.requestId,
                        buildJsonObject {
                            putJsonObject("state") {
                                put("status", "idle")
                                put("modelKey", modelKey)
                                put("thinkingLevel", thinkingLevel)
                            }
                        },
                    )
                }
                RemoteRequestMethod.SessionList -> respond(request.requestId, buildJsonObject { put("sessions", JsonArray(sessions)) })
                RemoteRequestMethod.SessionRename, RemoteRequestMethod.SessionPin -> {
                    val index = sessions.indexOfFirst { it["id"]?.jsonPrimitive?.content == sid }
                    if (index < 0) {
                        fail(request.requestId, RemoteErrorCode.NotFound, "Desktop session was not found")
                    } else {
                        val fields = sessions[index].toMutableMap()
                        payload?.get("title")?.let { fields["title"] = it }
                        payload?.get("pinned")?.jsonPrimitive?.booleanOrNull?.let { fields["pinnedAt"] = if (it) JsonPrimitive(9_000) else JsonNull }
                        sessions[index] = JsonObject(fields)
                        respond(request.requestId, buildJsonObject { put("session", sessions[index]) })
                    }
                }
                RemoteRequestMethod.SessionDelete -> {
                    sessions.removeAll { it["id"]?.jsonPrimitive?.content == sid }
                    respond(request.requestId, buildJsonObject { put("deleted", true) })
                }
                RemoteRequestMethod.ProjectList ->
                    respond(
                        request.requestId,
                        buildJsonObject {
                            putJsonArray("projects") {
                                add(project("/conv", "对话", "conversation"))
                                add(project("/code/vetta", "vetta", "project"))
                            }
                        },
                    )
                RemoteRequestMethod.SessionCreate -> {
                    val cwd = payload?.get("projectCwd")?.jsonPrimitive?.content ?: "/conv"
                    val created = session("s2", "", 2_000, cwd, live = true)
                    sessions.add(0, created)
                    respond(request.requestId, buildJsonObject { put("session", created) })
                }
                RemoteRequestMethod.SessionOpen ->
                    respond(request.requestId, buildJsonObject { putJsonObject("state") { put("status", "idle") } })
                RemoteRequestMethod.SessionHistory ->
                    respond(
                        request.requestId,
                        buildJsonObject {
                            putJsonArray("entries") {
                                add(
                                    buildJsonObject {
                                        put("kind", "user")
                                        put("id", "u1")
                                        put("text", "旧问题")
                                        put("at", 1)
                                    },
                                )
                            }
                            putJsonObject("state") { put("status", "idle") }
                        },
                    )
                RemoteRequestMethod.SessionPrompt -> {
                    respond(request.requestId, buildJsonObject { put("accepted", true) })
                    val text = payload?.get("text")?.jsonPrimitive?.content.orEmpty()
                    emit(RemoteEventName.SessionMessage, buildJsonObject { put("kind", "user"); put("text", text); put("at", 5) }, sid)
                    emit(
                        RemoteEventName.SessionTool,
                        buildJsonObject {
                            put("toolCallId", "t1")
                            put("toolName", "web_search")
                            put("phase", "completed")
                            put("args", """{"q":"周报"}""")
                        },
                        sid,
                    )
                    emit(RemoteEventName.SessionMessage, buildJsonObject { put("kind", "assistant_delta"); put("text", "好的，") }, sid)
                    emit(RemoteEventName.SessionMessage, buildJsonObject { put("kind", "assistant_delta"); put("text", "已完成") }, sid)
                    emit(
                        RemoteEventName.SessionInput,
                        buildJsonObject {
                            put("kind", "question")
                            putJsonObject("request") {
                                put("requestId", "q1")
                                putJsonArray("questions") {
                                    add(
                                        buildJsonObject {
                                            put("question", "要发邮件吗？")
                                            put("header", "确认")
                                            putJsonArray("options") {
                                                add(buildJsonObject { put("label", "发"); put("description", "") })
                                                add(buildJsonObject { put("label", "不发"); put("description", "") })
                                            }
                                        },
                                    )
                                }
                            }
                        },
                        sid,
                    )
                }
                RemoteRequestMethod.SessionRespond -> {
                    // The turn can end before the answer's own reply reaches the phone.
                    emit(RemoteEventName.SessionMessage, buildJsonObject { put("kind", "turn_end"); put("at", 9) }, sid)
                    emit(RemoteEventName.SessionState, buildJsonObject { put("status", "completed") }, sid)
                    delay(50)
                    respond(request.requestId, buildJsonObject { put("responded", true) })
                }
                else -> respond(request.requestId, buildJsonObject {})
            }
        }
        return desktop
    }

    private fun model(key: String, name: String, provider: String, levels: List<String>): JsonElement =
        buildJsonObject {
            put("key", key)
            put("name", name)
            put("provider", provider)
            put("thinkingLevels", buildJsonArray { levels.forEach { add(JsonPrimitive(it)) } })
            put("supportsImage", provider == "anthropic")
        }

    private fun project(cwd: String, name: String, kind: String): JsonElement =
        buildJsonObject {
            put("cwd", cwd)
            put("name", name)
            put("kind", kind)
            put("sessionCount", 1)
        }

    private fun methods(desktop: FakeDesktop, vararg of: RemoteRequestMethod): List<RemoteRequestMethod> =
        desktop.requests.map { it.method }.filter { it in of }

    @Test
    fun pairsPromptsAnswersAndUnpairs() =
        runTest {
            val desktop = scriptedDesktop()
            val device = Device()
            val mirror = mirror(desktop, device)
            assertTrue(mirror.state.value.ready && !mirror.state.value.paired)

            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertTrue(mirror.state.value.paired)
            assertEquals("MacBook Pro", mirror.state.value.desktop?.desktopName)
            assertTrue(eventually { mirror.state.value.online })
            assertTrue(eventually { mirror.state.value.sessions.map { it.id } == listOf("s1") })

            assertEquals("s2", mirror.sendPrompt(null, "  帮我写周报 "))
            assertTrue(eventually { mirror.state.value.transcript("s2").pendingQuestion?.requestId == "q1" })
            val transcript = mirror.state.value.transcript("s2")
            assertEquals(2, transcript.items.size)
            val user = transcript.items.first() as TranscriptItem.User
            assertEquals("帮我写周报", user.text)
            assertEquals(5L, user.at, "the desktop's copy replaced the optimistic bubble")
            val turn = (transcript.items.last() as TranscriptItem.Assistant).turn
            assertEquals("好的，已完成", turn.text)
            assertEquals(listOf("web_search"), turn.tools.map { it.toolName })
            assertEquals(RemoteSessionStatus.WaitingInput, mirror.state.value.session("s2")?.status)
            assertEquals("帮我写周报", mirror.state.value.session("s2")?.title)

            mirror.respond("s2", "q1", listOf(RemoteQuestionAnswer("要发邮件吗？", listOf("发"))))
            assertTrue(eventually { mirror.state.value.transcript("s2").sessionState.status == RemoteSessionStatus.Completed })
            assertNull(mirror.state.value.transcript("s2").pendingQuestion)
            assertEquals(RemoteSessionStatus.Completed, mirror.state.value.session("s2")?.status, "the list is not put back to running")
            assertEquals(1, device.turnEnds)

            mirror.openSession("s1")
            assertEquals(1, mirror.state.value.transcript("s1").items.size)

            mirror.unpair()
            assertFalse(mirror.state.value.paired)
            assertEquals(UnlinkReason.UnpairedHere, mirror.state.value.unlinked)
            assertTrue(mirror.state.value.sessions.isNotEmpty(), "unpairing takes nothing off the phone")
            assertFalse(mirror.state.value.link.isUsable)
            assertTrue(eventually { desktop.openSockets == 0 }, "unpairing closes the link")
        }

    @Test
    fun startsANewSessionInTheChosenProjectAndRemembersTheProjects() =
        runTest {
            val desktop = scriptedDesktop()
            val device = Device()
            val mirror = mirror(desktop, device)
            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertTrue(eventually { mirror.state.value.projects.map { it.cwd } == listOf("/conv", "/code/vetta") })
            assertEquals("/conv", mirror.state.value.conversationCwd)

            assertEquals("s2", mirror.sendPrompt(null, "跑一下测试", projectCwd = "/code/vetta"))
            assertEquals("/code/vetta", mirror.state.value.session("s2")?.projectCwd)
            assertTrue(eventually { mirror.state.value.count(SessionStatusGroup.Waiting) == 1 })
            val visible = SessionFilter(kind = SessionKind.Project).apply(mirror.state.value.sessions, mirror.state.value.conversationCwd)
            assertEquals(listOf("s2"), visible.map { it.id })

            mirror.setActive(false)
            val relaunched = mirror(desktop, device)
            assertEquals("/conv", relaunched.state.value.conversationCwd, "the project list survives a relaunch before the link is up")
            relaunched.unpair()
            assertEquals("/conv", relaunched.state.value.conversationCwd, "the earlier sessions still read by project after unpairing")
        }

    @Test
    fun followsTheDesktopToAnotherRelayWithoutLosingTheChats() =
        runTest {
            val desktop = scriptedDesktop()
            val device = Device()
            val mirror = mirror(desktop, device)
            assertTrue(mirror.pairWithCode(desktop.invite(relay = "wss://relay.example")))
            assertTrue(eventually { mirror.state.value.online && mirror.state.value.sessions.isNotEmpty() })
            val sessions = mirror.state.value.sessions

            desktop.emit(RemoteEventName.DeviceStatus, buildJsonObject {
                put("deviceName", "MacBook Pro")
                putJsonArray("lanEndpoints") {}
                put("relayEnabled", true)
                put("runningSessionCount", 0)
                put("relayBaseUrl", "wss://relay.mine.test")
            })
            assertTrue(eventually { mirror.state.value.desktop?.relayBaseUrl == "wss://relay.mine.test" })
            assertTrue(eventually { desktop.opened.any { it.startsWith("wss://relay.mine.test/") } }, "the link reconnects through the new relay")
            assertTrue(eventually { mirror.state.value.online })
            assertEquals(sessions.map { it.id }, mirror.state.value.sessions.map { it.id }, "the chats stay while it moves")
            assertTrue(mirror.viewerUrl()!!.startsWith("wss://relay.mine.test/"))

            val relaunched = mirror(desktop, device)
            assertEquals("wss://relay.mine.test", relaunched.state.value.desktop?.relayBaseUrl, "the new relay is remembered")
        }

    @Test
    fun uploadsAttachmentsOneByOneBeforeThePromptAndKeepsThemOnTheBubble() =
        runTest {
            val desktop = scriptedDesktop()
            val mirror = mirror(desktop)
            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertTrue(eventually { mirror.state.value.online })

            val photo = PromptAttachment(AttachmentKind.Image, "photo-1.jpg", "image/jpeg", byteArrayOf(1, 2, 3))
            val notes = PromptAttachment(AttachmentKind.File, "notes.txt", "text/plain", "hi".encodeToByteArray())
            assertEquals("s2", mirror.sendPrompt(null, "看看这些", attachments = listOf(photo, notes)))
            val sent = desktop.requests.filter { it.method == RemoteRequestMethod.SessionUpload || it.method == RemoteRequestMethod.SessionPrompt }
            assertEquals(
                listOf(RemoteRequestMethod.SessionUpload, RemoteRequestMethod.SessionUpload, RemoteRequestMethod.SessionPrompt),
                sent.map { it.method },
            )
            val firstUpload = sent.first().payload as JsonObject
            assertEquals("photo-1.jpg", firstUpload["name"]?.jsonPrimitive?.content)
            assertEquals("AQID", firstUpload["data"]?.jsonPrimitive?.content)
            assertEquals(JsonArray(listOf(JsonPrimitive("up-1"), JsonPrimitive("up-2"))), (sent.last().payload as JsonObject)["attachments"])

            // The desktop echoes the prompt without attachments; the bubble keeps what this phone sent.
            assertTrue(
                eventually {
                    val first = mirror.state.value.transcript("s2").items.firstOrNull() as? TranscriptItem.User
                    first != null && !first.id.startsWith("local") && first.attachments.size == 2
                },
            )
            assertEquals(
                listOf(TranscriptAttachment(AttachmentKind.Image, "photo-1.jpg"), TranscriptAttachment(AttachmentKind.File, "notes.txt")),
                (mirror.state.value.transcript("s2").items.first() as TranscriptItem.User).attachments,
            )
        }

    @Test
    fun showsThePromptRunningBeforeUploadsAndTakesItBackWhenTheDesktopRefuses() =
        runTest {
            val desktop = scriptedDesktop()
            val scripted = desktop.handler
            val uploadGate = CompletableDeferred<Unit>()
            desktop.handler = { request ->
                when (request.method) {
                    RemoteRequestMethod.SessionUpload -> {
                        uploadGate.await()
                        scripted(request)
                    }
                    RemoteRequestMethod.SessionPrompt -> fail(request.requestId, RemoteErrorCode.Busy, "Desktop session is already processing a turn")
                    else -> scripted(request)
                }
            }
            val mirror = mirror(desktop)
            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertTrue(eventually { mirror.state.value.sessions.any { it.id == "s1" } })

            val photo = PromptAttachment(AttachmentKind.Image, "photo-1.jpg", "image/jpeg", byteArrayOf(1, 2, 3))
            val sending = async { mirror.sendPrompt("s1", "看看这张", attachments = listOf(photo)) }
            assertTrue(
                eventually { mirror.state.value.transcript("s1").items.any { it is TranscriptItem.User && it.text == "看看这张" } },
                "the prompt shows while the photo is still uploading",
            )
            assertEquals(RemoteSessionStatus.Running, mirror.state.value.transcript("s1").sessionState.status)
            assertEquals(RemoteSessionStatus.Running, mirror.state.value.session("s1")?.status)

            uploadGate.complete(Unit)
            assertNull(sending.await(), "a refused prompt was not sent")
            assertTrue(mirror.state.value.transcript("s1").items.none { it is TranscriptItem.User && it.text == "看看这张" }, "the refused prompt is taken back")
            assertEquals(RemoteSessionStatus.Idle, mirror.state.value.transcript("s1").sessionState.status)
            assertEquals(RemoteSessionStatus.Completed, mirror.state.value.session("s1")?.status)
            assertTrue(mirror.state.value.lastError != null)
        }

    @Test
    fun listsModelsAndSwitchesModelAndThinkingLevel() =
        runTest {
            val desktop = scriptedDesktop()
            val mirror = mirror(desktop)
            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertTrue(eventually { mirror.state.value.sessions.map { it.id } == listOf("s1") })

            mirror.loadModels("s1")
            assertEquals(listOf("anthropic/claude-fable-5-1", "zai/glm-5"), mirror.state.value.models["s1"]?.map { it.key })
            assertTrue(mirror.configure("s1", modelKey = "zai/glm-5", thinkingLevel = "max"))
            assertEquals("zai/glm-5", mirror.state.value.transcript("s1").sessionState.modelKey)
            assertEquals("max", mirror.state.value.transcript("s1").sessionState.thinkingLevel)
            assertFalse(mirror.configure("s1"), "nothing to change sends nothing")
            mirror.loadModels("old-desktop")
            assertNull(mirror.state.value.models["old-desktop"])
            assertNull(mirror.state.value.lastError, "a desktop without model.list leaves the title as is, without an alert")
        }

    @Test
    fun startsANewSessionOnTheChosenModel() =
        runTest {
            val desktop = scriptedDesktop()
            val mirror = mirror(desktop)
            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertTrue(eventually { mirror.state.value.sessions.map { it.id } == listOf("s1") })

            mirror.loadNewSessionModels()
            assertEquals(listOf("anthropic/claude-fable-5-1", "zai/glm-5"), mirror.state.value.newSessionModels.map { it.key })
            assertEquals("s1", desktop.requests.last { it.method == RemoteRequestMethod.ModelList }.sessionId, "borrowed from the most recent session")

            assertEquals("s2", mirror.sendPrompt(null, "你好", modelKey = "zai/glm-5", thinkingLevel = "max"))
            assertEquals(
                listOf(RemoteRequestMethod.SessionCreate, RemoteRequestMethod.SessionConfigure, RemoteRequestMethod.SessionPrompt),
                methods(desktop, RemoteRequestMethod.SessionCreate, RemoteRequestMethod.SessionConfigure, RemoteRequestMethod.SessionPrompt),
                "model and level go out in one configure",
            )
            assertEquals("s2", desktop.requests.first { it.method == RemoteRequestMethod.SessionConfigure }.sessionId)
            assertEquals("zai/glm-5", mirror.state.value.transcript("s2").sessionState.modelKey)
            assertEquals("max", mirror.state.value.transcript("s2").sessionState.thinkingLevel)

            assertNotNull(mirror.sendPrompt(null, "再来", projectCwd = "/code/vetta"))
            assertEquals(1, desktop.requests.count { it.method == RemoteRequestMethod.SessionConfigure }, "no choice leaves the desktop's defaults untouched")
        }

    @Test
    fun openingAJustStartedSessionKeepsItsPrompt() =
        runTest {
            val desktop = scriptedDesktop()
            val mirror = mirror(desktop)
            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertTrue(eventually { mirror.state.value.sessions.map { it.id } == listOf("s1") })

            val localId = assertNotNull(mirror.startSession("你好"))
            assertTrue(eventually { !mirror.state.value.isStarting(localId) && mirror.state.value.resolve(localId) == "s2" })
            assertTrue(eventually { mirror.state.value.transcript("s2").items.size >= 2 })

            // The chat opens the session as soon as the prompt is out; the desktop's history
            // (the fake's never has "你好") may not have it yet and must not replace the chat.
            mirror.openSession("s2")
            assertTrue(desktop.requests.any { it.method == RemoteRequestMethod.SessionOpen && it.sessionId == "s2" })
            assertTrue(desktop.requests.none { it.method == RemoteRequestMethod.SessionHistory && it.sessionId == "s2" })
            assertEquals("你好", (mirror.state.value.transcript("s2").items.first() as? TranscriptItem.User)?.text, "the prompt stays")
            assertTrue(mirror.state.value.session("s2")?.live == true)

            mirror.openSession("s2")
            assertTrue(desktop.requests.any { it.method == RemoteRequestMethod.SessionHistory && it.sessionId == "s2" }, "only the first opening skips history")
        }

    @Test
    fun listsSkillsPerProjectAndGlobalOnesForConversations() =
        runTest {
            val desktop = scriptedDesktop()
            val asked = mutableListOf<String?>()
            val scripted = desktop.handler
            desktop.handler = { request ->
                if (request.method == RemoteRequestMethod.SkillList) {
                    val cwd = (request.payload as? JsonObject)?.get("cwd")?.jsonPrimitive?.content
                    asked += cwd
                    respond(
                        request.requestId,
                        buildJsonObject {
                            putJsonArray("skills") {
                                add(buildJsonObject { put("name", if (cwd == null) "global" else "project"); put("description", ""); put("type", "skill"); put("source", "user") })
                            }
                        },
                    )
                } else {
                    scripted(request)
                }
            }
            val mirror = mirror(desktop)
            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertTrue(eventually { mirror.state.value.online })

            mirror.loadSkills("/code/vetta")
            mirror.loadSkills(null)
            assertEquals(listOf<String?>("/code/vetta", null), asked)
            assertEquals(listOf("project"), mirror.state.value.skillCatalog("/code/vetta").options?.map { it.name })
            assertEquals(listOf("global"), mirror.state.value.skillCatalog(null).options?.map { it.name })

            desktop.reachable = false
            desktop.dropConnections()
            assertTrue(eventually { !mirror.state.value.online })
            mirror.loadSkills(null)
            assertTrue(mirror.state.value.skillCatalog(null).failed)
            assertEquals(listOf("global"), mirror.state.value.skillCatalog(null).options?.map { it.name }, "the last list stays")
        }

    @Test
    fun browsesAndReadsTheSessionsFilesOnlyFromADesktopThatServesThem() =
        runTest {
            val desktop = scriptedDesktop()
            val scripted = desktop.handler
            desktop.handler = { request ->
                when (request.method) {
                    RemoteRequestMethod.FileList ->
                        respond(
                            request.requestId,
                            buildJsonObject {
                                put("path", "")
                                putJsonArray("entries") {
                                    add(buildJsonObject { put("name", "b.md"); put("path", "b.md"); put("isDirectory", false); put("size", 5); put("modifiedAt", 1) })
                                    add(buildJsonObject { put("name", "src"); put("path", "src"); put("isDirectory", true); put("size", 0); put("modifiedAt", 1) })
                                }
                            },
                        )
                    RemoteRequestMethod.FileStat ->
                        respond(
                            request.requestId,
                            buildJsonObject {
                                putJsonObject("file") {
                                    put("name", "b.md"); put("path", "b.md"); put("isDirectory", false); put("size", 5); put("modifiedAt", 1)
                                    put("mimeType", "text/markdown"); put("displayPath", "~/vetta/b.md")
                                }
                            },
                        )
                    RemoteRequestMethod.FileRead ->
                        respond(
                            request.requestId,
                            buildJsonObject { put("data", "IyBIaQ=="); put("offset", 0); put("totalSize", 4); put("modifiedAt", 1); put("mimeType", "text/markdown") },
                        )
                    else -> scripted(request)
                }
            }
            val mirror = mirror(desktop)
            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertTrue(eventually { mirror.state.value.online })
            desktop.emit(RemoteEventName.DeviceStatus, buildJsonObject { put("deviceName", "MacBook Pro") })
            testScheduler.runCurrent()
            val old = runCatching { mirror.listFiles("s1", "") }.exceptionOrNull() as? FileViewException
            assertEquals(FileViewError.UnsupportedDesktop, old?.reason, "an older desktop is not asked")

            desktop.emit(RemoteEventName.DeviceStatus, buildJsonObject { put("deviceName", "MacBook Pro"); put("fileRead", true) })
            assertTrue(eventually { mirror.state.value.link.desktop?.fileRead == true })
            assertEquals(listOf("src", "b.md"), mirror.listFiles("s1", "").map { it.name }, "folders first")
            val info = mirror.statFile("s1", "./b.md")
            assertEquals("~/vetta/b.md", info.displayPath)
            assertEquals("# Hi", mirror.readFile("s1", info).data.decodeToString())
            mirror.readFile("s1", info)
            assertEquals(1, desktop.requests.count { it.method == RemoteRequestMethod.FileRead }, "an unchanged file is read once")
        }

    @Test
    fun opensAPhotoLargerThanTheLimitThatTheDesktopScalesDown() =
        runTest {
            val desktop = scriptedDesktop()
            val scripted = desktop.handler
            desktop.handler = { request ->
                when (request.method) {
                    RemoteRequestMethod.FileStat ->
                        respond(
                            request.requestId,
                            buildJsonObject {
                                putJsonObject("file") {
                                    put("name", "IMG_0001.HEIC"); put("path", "IMG_0001.HEIC"); put("isDirectory", false); put("size", 20 * 1024 * 1024); put("modifiedAt", 1)
                                    put("mimeType", "image/heic"); put("displayPath", "~/vetta/IMG_0001.HEIC")
                                }
                            },
                        )
                    // The desktop sends a scaled-down JPEG well under the limit.
                    RemoteRequestMethod.FileRead ->
                        respond(
                            request.requestId,
                            buildJsonObject { put("data", "/9j/"); put("offset", 0); put("totalSize", 3); put("modifiedAt", 1); put("mimeType", "image/jpeg") },
                        )
                    else -> scripted(request)
                }
            }
            val mirror = mirror(desktop)
            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertTrue(eventually { mirror.state.value.online })
            desktop.emit(RemoteEventName.DeviceStatus, buildJsonObject { put("deviceName", "MacBook Pro"); put("fileRead", true) })
            assertTrue(eventually { mirror.state.value.link.desktop?.fileRead == true })
            val photo = mirror.readFile("s1", mirror.statFile("s1", "IMG_0001.HEIC"))
            assertEquals("image/jpeg", photo.mimeType)
            assertEquals(3, photo.data.size)
        }

    @Test
    fun remembersTheLastUsedModelPerDesktopAcrossLaunches() =
        runTest {
            val desktop = scriptedDesktop()
            val device = Device()
            val mirror = mirror(desktop, device)
            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertTrue(eventually { mirror.state.value.sessions.map { it.id } == listOf("s1") })
            assertEquals(ModelChoice(), mirror.state.value.lastModelChoice, "nothing used yet: the desktop's default")

            assertNotNull(mirror.startSession("你好", modelKey = "zai/glm-5", thinkingLevel = "max"))
            assertEquals(ModelChoice("zai/glm-5", "max"), mirror.state.value.lastModelChoice, "remembered as soon as it is used")

            assertTrue(mirror.configure("s1", modelKey = "anthropic/claude-fable-5-1"))
            assertEquals("anthropic/claude-fable-5-1", mirror.state.value.lastModelChoice.modelKey, "switching in a chat counts as using it")

            mirror.setActive(false)
            val relaunched = mirror(desktop, device)
            assertEquals(mirror.state.value.lastModelChoice, relaunched.state.value.lastModelChoice)
            relaunched.unpair()
            assertNotNull(device.settings.getStringOrNull(DesktopMirror.LAST_MODEL_KEY_PREFIX + desktop.identityKey), "kept for when this computer is paired again")
        }

    @Test
    fun readiesNewSessionModelsFromAnOpenSessionAndKeepsThemAcrossLaunches() =
        runTest {
            val desktop = scriptedDesktop(moreSessions = listOf(session("s0", "开着的", 500, live = true)))
            val device = Device()
            val mirror = mirror(desktop, device)
            assertTrue(mirror.pairWithCode(desktop.invite()))

            val keys = listOf("anthropic/claude-fable-5-1", "zai/glm-5")
            assertTrue(eventually { mirror.state.value.newSessionModels.map { it.key } == keys }, "fetched once the list is in, before New Session opens")
            assertEquals(
                listOf("s0"),
                desktop.requests.filter { it.method == RemoteRequestMethod.ModelList }.map { it.sessionId },
                "the session the desktop already has open, not the more recent closed one",
            )

            val before = desktop.requests.count { it.method == RemoteRequestMethod.ModelList }
            val first = async { mirror.loadNewSessionModels() }
            val second = async { mirror.loadNewSessionModels() }
            first.await()
            second.await()
            assertTrue(desktop.requests.count { it.method == RemoteRequestMethod.ModelList } - before <= 1, "concurrent loads share one request")

            mirror.setActive(false)
            val relaunched = mirror(desktop, device)
            assertEquals(keys, relaunched.state.value.newSessionModels.map { it.key }, "shown at once on the next launch")
            relaunched.unpair()
            assertNotNull(device.settings.getStringOrNull(DesktopMirror.MODELS_KEY_PREFIX + desktop.identityKey), "kept for when this computer is paired again")
        }

    @Test
    fun renamesPinsAndDeletesSessionsOnTheDesktop() =
        runTest {
            val desktop = scriptedDesktop()
            val mirror = mirror(desktop)
            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertTrue(eventually { mirror.state.value.sessions.map { it.id } == listOf("s1") })

            assertTrue(mirror.rename("s1", "  月报  "))
            assertEquals("月报", mirror.state.value.session("s1")?.title)
            assertFalse(mirror.rename("s1", "   "), "a blank title is not sent")

            assertTrue(mirror.setPinned("s1", true))
            assertEquals(9_000L, mirror.state.value.session("s1")?.pinnedAt, "the desktop's pin time wins")
            assertTrue(mirror.setPinned("s1", false))
            assertFalse(mirror.state.value.session("s1")!!.pinned)

            assertFalse(mirror.setPinned("ghost", true))
            assertNotNull(mirror.state.value.lastError)
            mirror.clearError()

            mirror.openSession("s1")
            assertTrue(mirror.deleteSession("s1"))
            assertTrue(mirror.state.value.sessions.isEmpty())
            assertNull(mirror.state.value.transcripts["s1"])
        }

    @Test
    fun startsASessionAtOnceAndHandsTheChatOverToTheDesktopsId() =
        runTest {
            val desktop = scriptedDesktop()
            val mirror = mirror(desktop)
            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertTrue(eventually { mirror.state.value.sessions.map { it.id } == listOf("s1") })

            var failed = false
            val photo = PromptAttachment(AttachmentKind.Image, "photo-1.jpg", "image/jpeg", byteArrayOf(1))
            val localId = assertNotNull(mirror.startSession("你好", modelKey = "zai/glm-5", attachments = listOf(photo)) { failed = true })
            // Nothing has reached the desktop yet, and the chat already shows the prompt.
            val starting = mirror.state.value
            assertTrue(starting.isStarting(localId))
            assertEquals(localId, starting.resolve(localId))
            assertEquals(1, starting.transcript(localId).items.size)
            assertEquals(RemoteSessionStatus.Running, starting.transcript(localId).sessionState.status)

            assertTrue(eventually { !mirror.state.value.isStarting(localId) })
            assertFalse(failed)
            assertEquals("s2", mirror.state.value.resolve(localId))
            assertNull(mirror.state.value.transcripts[localId])
            assertEquals(
                listOf(RemoteRequestMethod.SessionCreate, RemoteRequestMethod.SessionConfigure, RemoteRequestMethod.SessionUpload, RemoteRequestMethod.SessionPrompt),
                methods(
                    desktop,
                    RemoteRequestMethod.SessionCreate,
                    RemoteRequestMethod.SessionConfigure,
                    RemoteRequestMethod.SessionUpload,
                    RemoteRequestMethod.SessionPrompt,
                ),
            )
            assertTrue(
                eventually { mirror.state.value.transcript("s2").items.count { it is TranscriptItem.User } == 1 },
                "the prompt shows once, not again when the desktop echoes it",
            )
            assertNull(mirror.startSession("   "))
        }

    @Test
    fun aStartThatCannotReachTheDesktopReportsBack() =
        runTest {
            val mirror = mirror(scriptedDesktop())
            var failed = false
            val localId = assertNotNull(mirror.startSession("你好") { failed = true })
            assertTrue(eventually { failed })
            assertFalse(mirror.state.value.isStarting(localId))
            assertNull(mirror.state.value.transcripts[localId])
            assertEquals(MirrorError.NotConnected, mirror.state.value.lastError)
        }

    @Test
    fun reportsOfflineInsteadOfSendingAndHonoursLiveThinking() =
        runTest {
            val device = Device()
            val mirror = mirror(scriptedDesktop(), device)
            assertNull(mirror.sendPrompt(null, "hi"))
            assertNull(mirror.sendPrompt("s1", "hi"), "a failed send reports nothing sent, so the composer can keep the text")
            assertEquals(MirrorError.NotConnected, mirror.state.value.lastError)
            mirror.setPreferences { it.copy(liveThinking = false) }
            assertFalse(mirror.state.value.preferences.liveThinking)
            assertFalse(mirror(scriptedDesktop(), device).state.value.preferences.liveThinking, "preferences survive a relaunch")
        }

    @Test
    fun restoresThePairedDesktopAndCachedSessionsOnLaunch() =
        runTest {
            val desktop = scriptedDesktop()
            val device = Device()
            val first = mirror(desktop, device)
            assertTrue(first.pairWithCode(desktop.invite()))
            assertTrue(eventually { first.state.value.sessions.size == 1 })
            first.setActive(false)

            val second = mirror(desktop, device)
            assertTrue(second.state.value.paired)
            assertEquals(listOf("s1"), second.state.value.sessions.map { it.id })
            assertTrue(eventually { second.state.value.online })
            assertNull(device.settings.getStringOrNull(PairingStore.DESKTOPS_KEY)?.takeIf { FakeDesktop.MOBILE_SECRET in it }, "the pairing secret is not kept in plain settings")
        }

    @Test
    fun keepsThePhoneIdentityAnEarlierBuildPinned() =
        runTest {
            val legacy = RemoteCrypto.generateIdentityKeyPair()
            val legacySecret = RemoteCrypto.toBase64Url(legacy.secretKey)
            val desktop = scriptedDesktop()
            val mirror = mirror(desktop, legacyIdentity = legacySecret)
            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertEquals(RemoteCrypto.toBase64Url(legacy.publicKey), desktop.hellos.first().identityKey)
        }

    @Test
    fun catchesUpOnEventsMissedWhileTheLinkWasDown() =
        runTest {
            val desktop = scriptedDesktop()
            val mirror = mirror(desktop)
            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertTrue(eventually { mirror.state.value.sessions.isNotEmpty() })
            mirror.openSession("s1")

            desktop.dropConnections()
            assertTrue(eventually { !mirror.state.value.online })
            desktop.journalWhileAway(RemoteEventName.SessionMessage, buildJsonObject { put("kind", "user"); put("text", "在电脑上问的"); put("at", 7) }, "s1")

            assertTrue(eventually(timeoutMs = 10_000) { mirror.state.value.online }, "the link reconnects on its own")
            assertTrue(
                eventually { mirror.state.value.transcript("s1").items.any { (it as? TranscriptItem.User)?.text == "在电脑上问的" } },
                "the desktop replays what happened after the last event this phone saw",
            )
            assertEquals(1, mirror.state.value.transcript("s1").items.count { (it as? TranscriptItem.User)?.text == "在电脑上问的" })
        }

    @Test
    fun aStreamingReplyDoesNotRewriteThePairingForEveryEvent() =
        runTest {
            val desktop = scriptedDesktop()
            val device = Device()
            val mirror = mirror(desktop, device)
            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertTrue(eventually { mirror.state.value.sessions.isNotEmpty() })
            var writes = 0
            device.settings.addStringOrNullListener(PairingStore.DESKTOPS_KEY) { writes += 1 }

            repeat(200) { desktop.emit(RemoteEventName.SessionMessage, buildJsonObject { put("kind", "assistant_delta"); put("text", "字") }, "s1") }
            assertTrue(eventually { mirror.state.value.transcript("s1").items.isNotEmpty() })
            assertTrue(writes <= 1, "at most one save while the reply streams, not one per piece ($writes)")

            // Leaving the app saves where the phone got to, so a relaunch resumes from there.
            mirror.setActive(false)
            val stored = PairingStore(device.settings, SettingsSecretStore(device.secrets)).also { it.load(null) }.getCurrent()
            assertEquals(desktop.lastSequence, stored?.lastEventSequence)
        }

    @Test
    fun keepsEverythingReadableWhenTheComputerUnpairsThisPhoneAndSyncsAgainOnPairing() =
        runTest {
            val desktop = scriptedDesktop()
            val device = Device()
            val mirror = mirror(desktop, device)
            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertTrue(eventually { mirror.state.value.sessions.isNotEmpty() })
            mirror.openSession("s1")
            desktop.emit(RemoteEventName.SessionMessage, buildJsonObject { put("kind", "user"); put("text", "在电脑上问的"); put("at", 7) }, "s1")
            assertTrue(eventually { mirror.state.value.transcript("s1").items.isNotEmpty() })
            val sessions = mirror.state.value.sessions.map { it.id }

            desktop.revoke()
            assertTrue(eventually { !mirror.state.value.paired })
            assertEquals(UnlinkReason.UnpairedOnComputer, mirror.state.value.unlinked)
            assertEquals(sessions, mirror.state.value.sessions.map { it.id }, "nothing disappears from the phone")
            assertTrue(mirror.state.value.transcript("s1").items.isNotEmpty())
            assertEquals("MacBook Pro", mirror.state.value.desktop?.desktopName)

            // Still there after a relaunch, and the chats still open from the phone's copy.
            advanceTimeBy(1_000) // the chat is written to the cache a moment after it changes
            mirror.setActive(false)
            val relaunched = mirror(desktop, device)
            assertFalse(relaunched.state.value.paired)
            assertEquals(UnlinkReason.UnpairedOnComputer, relaunched.state.value.unlinked)
            assertEquals(sessions, relaunched.state.value.sessions.map { it.id })
            relaunched.openSession("s1")
            assertTrue(eventually { relaunched.state.value.transcript("s1").items.isNotEmpty() })

            // Pairing with the same computer again carries on syncing the same sessions.
            assertTrue(relaunched.pairWithCode(desktop.invite()))
            assertNull(relaunched.state.value.unlinked)
            assertTrue(eventually { relaunched.state.value.online })
            assertEquals(sessions, relaunched.state.value.sessions.map { it.id })
        }

    @Test
    fun opensTheCachedChatOfflineEvenAfterEventsForItArrived() =
        runTest {
            val desktop = scriptedDesktop()
            val device = Device()
            val mirror = mirror(desktop, device)
            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertTrue(eventually { mirror.state.value.online })
            mirror.openSession("s1")
            desktop.emit(RemoteEventName.SessionMessage, buildJsonObject { put("kind", "user"); put("text", "在电脑上问的"); put("at", 7) }, "s1")
            assertTrue(eventually { mirror.state.value.transcript("s1").items.isNotEmpty() })
            advanceTimeBy(1_000)
            mirror.setActive(false)

            // Next launch: an event for the chat arrives before it is opened, then the link goes.
            val relaunched = mirror(desktop, device)
            assertTrue(eventually { relaunched.state.value.online })
            desktop.emit(RemoteEventName.SessionState, buildJsonObject { put("status", "idle") }, "s1")
            assertTrue(eventually { relaunched.state.value.transcripts["s1"] != null })
            desktop.reachable = false
            desktop.dropConnections()
            assertTrue(eventually { !relaunched.state.value.online })

            relaunched.openSession("s1")
            assertTrue(relaunched.state.value.transcript("s1").items.isNotEmpty(), "the phone's copy, not an endless loading")
        }

    @Test
    fun aComputerThatOnlySeemsToHaveUnpairedThisPhoneChangesNothing() =
        runTest {
            val desktop = scriptedDesktop()
            val mirror = mirror(desktop)
            assertTrue(mirror.pairWithCode(desktop.invite(relay = "wss://relay.example", lan = listOf("192.168.1.20:43117"))))
            assertTrue(eventually { mirror.state.value.online })
            val sessions = mirror.state.value.sessions

            desktop.forgotPairing = true
            desktop.reachable = false
            desktop.dropConnections()
            assertTrue(eventually(timeoutMs = 10_000) { mirror.state.value.link.lastError == DesktopLink.UNKNOWN_PAIRING }, "shown as a hint on the link")
            assertTrue(mirror.state.value.paired, "another computer may hold the old address: the pairing stays")
            assertNull(mirror.state.value.unlinked)
            assertEquals(sessions, mirror.state.value.sessions)
        }

    @Test
    fun keepsTheRecentChatsOnThePhoneWithoutOpeningThem() =
        runTest {
            val desktop = scriptedDesktop(moreSessions = listOf(session("s3", "上周的方案", 900)))
            val device = Device()
            val mirror = mirror(desktop, device)
            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertTrue(eventually { device.cache.loadTranscript(desktop.identityKey, "s1") != null && device.cache.loadTranscript(desktop.identityKey, "s3") != null })
            assertTrue(desktop.requests.none { it.method == RemoteRequestMethod.SessionOpen }, "reading the saved chat does not load the session on the desktop")

            // Nothing changed: nothing is fetched again.
            val fetched = desktop.requests.count { it.method == RemoteRequestMethod.SessionHistory }
            mirror.refreshSessions()
            advanceTimeBy(1_000)
            assertEquals(fetched, desktop.requests.count { it.method == RemoteRequestMethod.SessionHistory })

            // Offline, a chat never opened here still reads in full.
            desktop.reachable = false
            desktop.dropConnections()
            assertTrue(eventually { !mirror.state.value.online })
            mirror.openSession("s3")
            assertTrue(mirror.state.value.transcript("s3").items.isNotEmpty())
        }

    @Test
    fun aManualPairingIsKeptAndConnectsOverTheLocalNetwork() =
        runTest {
            val desktop = scriptedDesktop()
            val device = Device()
            val mirror = mirror(desktop, device)
            val pairing = async { mirror.pairManually(FakeDesktop.LAN_ENDPOINT) }
            assertTrue(eventually { mirror.state.value.pairing is org.vetta.android.domain.remote.pairing.PairingPhase.AwaitingApproval })

            desktop.approveManual()
            assertTrue(pairing.await())
            assertTrue(eventually { mirror.state.value.online })
            assertEquals(org.vetta.android.domain.remote.link.LinkChannel.Lan, mirror.state.value.link.channel)
            assertEquals(org.vetta.android.domain.remote.pairing.PairingPhase.Idle, mirror.state.value.pairing)

            val relaunched = mirror(desktop, device)
            assertTrue(eventually { relaunched.state.value.online }, "the credential from the desktop is kept")
            assertEquals(FakeDesktop.MOBILE_SECRET, desktop.secrets.last())
        }

    @Test
    fun pairingWithAnUnusableCodeReportsWhy() =
        runTest {
            val desktop = scriptedDesktop()
            val mirror = mirror(desktop)
            assertFalse(mirror.pairWithCode("vetta://pair?v=1&id=x"))
            assertEquals(
                org.vetta.android.domain.remote.pairing.PairingPhase.Failed(org.vetta.android.domain.remote.pairing.PairingFailure.InvalidCode),
                mirror.state.value.pairing,
            )
            desktop.reachable = false
            assertFalse(mirror.pairWithCode(desktop.invite()))
            assertEquals(
                org.vetta.android.domain.remote.pairing.PairingPhase.Failed(org.vetta.android.domain.remote.pairing.PairingFailure.Unreachable),
                mirror.state.value.pairing,
            )
            assertFalse(mirror.state.value.paired)
        }

    @Test
    fun subscribesToTheScreenOnlyWhileItIsOpenAndTheAppIsInFront() =
        runTest {
            val desktop = scriptedDesktop()
            val subscriptions = mutableListOf<Boolean>()
            val cursorAsked = mutableListOf<Boolean?>()
            val scripted = desktop.handler
            desktop.handler = { request ->
                if (request.method == RemoteRequestMethod.ScreenSubscribe) {
                    val active = (request.payload as JsonObject)["active"]!!.jsonPrimitive.booleanOrNull!!
                    subscriptions += active
                    cursorAsked += (request.payload as JsonObject)["cursor"]?.jsonPrimitive?.booleanOrNull
                    respond(
                        request.requestId,
                        buildJsonObject {
                            put("screen", if (active) "streaming" else "stopped")
                            put("input", "permission_denied")
                        },
                    )
                } else {
                    scripted(request)
                }
            }
            val mirror = mirror(desktop)
            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertTrue(eventually { mirror.state.value.online })
            assertEquals(true, desktop.hellos.last().capabilities.screen, "the phone says it subscribes on demand")
            desktop.emit(RemoteEventName.DeviceStatus, buildJsonObject { put("deviceName", "MacBook Pro"); put("screen", true) })
            testScheduler.runCurrent()

            mirror.setScreenOpen(true)
            assertTrue(eventually { mirror.state.value.screen?.input == RemoteInputState.PermissionDenied })
            assertEquals(listOf(true), subscriptions)
            assertEquals(listOf<Boolean?>(true), cursorAsked, "the phone draws the pointer and asks for its shape")

            desktop.emit(
                RemoteEventName.ScreenCursor,
                buildJsonObject {
                    put("image", "iVBORw0KGgo=")
                    put("width", 16)
                    put("height", 24)
                    put("hotspotX", 3)
                    put("hotspotY", 40)
                    put("screenWidth", 1512)
                },
            )
            assertTrue(eventually { mirror.state.value.screenCursor != null })
            assertEquals(24f, mirror.state.value.screenCursor!!.hotspotY, "the hot spot stays on the image")

            desktop.emit(RemoteEventName.ScreenStatus, buildJsonObject { put("screen", "streaming"); put("input", "ready") })
            assertTrue(eventually { mirror.state.value.screen?.input == RemoteInputState.Ready })

            mirror.setActive(false)
            assertTrue(eventually { subscriptions == listOf(true, false) }, "the background stops the capture")
            assertNull(mirror.state.value.screen)
            assertNull(mirror.state.value.screenCursor)
            mirror.setActive(true)
            assertTrue(eventually { subscriptions.last() })

            // Every connection brings a device.status: a desktop that lost the phone for a moment forgot it.
            desktop.emit(RemoteEventName.DeviceStatus, buildJsonObject { put("deviceName", "MacBook Pro"); put("screen", true) })
            assertTrue(eventually { subscriptions.size == 4 && subscriptions.last() })

            mirror.setScreenOpen(false)
            assertTrue(eventually { subscriptions.size == 5 && !subscriptions.last() })
            assertNull(mirror.state.value.screen)
        }

    @Test
    fun neverAsksAnOlderDesktopForItsScreen() =
        runTest {
            val desktop = scriptedDesktop()
            val mirror = mirror(desktop)
            assertTrue(mirror.pairWithCode(desktop.invite()))
            assertTrue(eventually { mirror.state.value.online })
            desktop.emit(RemoteEventName.DeviceStatus, buildJsonObject { put("deviceName", "MacBook Pro") })
            testScheduler.runCurrent()

            mirror.setScreenOpen(true)
            testScheduler.runCurrent()
            mirror.setScreenOpen(false)
            testScheduler.runCurrent()
            assertTrue(desktop.requests.none { it.method == RemoteRequestMethod.ScreenSubscribe })
        }
}
