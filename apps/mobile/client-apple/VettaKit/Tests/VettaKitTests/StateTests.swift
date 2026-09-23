import Foundation
import Testing
@testable import VettaKit

@Suite struct TranscriptReducerTests {
	func run(_ actions: [TranscriptAction], from initial: TranscriptState = .empty) -> TranscriptState {
		actions.reduce(initial, TranscriptReducer.reduce)
	}

	func assistant(_ item: TranscriptItem?) -> AssistantTurn? {
		if case let .assistant(turn) = item { return turn }
		return nil
	}

	@Test func loadsHistory() {
		let state = run([.history(entries: [
			.user(id: "u1", text: "帮我整理", at: 1),
			.assistant(id: "a1", text: "好的", thinking: "先搜索", toolCalls: [RemoteToolCallSummary(toolCallId: "t1", toolName: "web_search", args: "{}", result: "ok")], at: nil, error: nil),
			.marker(id: "m1", text: "上下文已压缩", at: nil),
		], state: RemoteSessionState(status: .idle))])
		#expect(state.loaded)
		#expect(state.items.count == 3)
		#expect(assistant(state.items[1])?.tools.first?.status == .done)
		#expect(assistant(state.items[1])?.thinking == "先搜索")
	}

	@Test func streamsIntoOneBubbleThenFinalizes() {
		let state = run([
			.message(.user(text: "hi", at: 1)),
			.state(RemoteSessionState(status: .running)),
			.message(.thinkingDelta("想")),
			.message(.assistantDelta("你")),
			.message(.assistantDelta("好")),
			.message(.turnEnd(at: 2)),
			.state(RemoteSessionState(status: .completed)),
		])
		#expect(state.items.count == 2)
		let turn = assistant(state.items[1])
		#expect(turn?.text == "你好")
		#expect(turn?.thinking == "想")
		#expect(turn?.streaming == false)
	}

	@Test func replacesTheOptimisticLocalBubble() {
		let state = run([.localUser(text: "同样的话", at: 1), .message(.user(text: "同样的话", at: 2))])
		#expect(state.items.count == 1)
		#expect(state.items.first?.at == 2)
	}

	@Test func tracksToolCardsThroughTheirPhases() {
		let base = run([
			.state(RemoteSessionState(status: .running)),
			.tool(RemoteToolEvent(toolCallId: "t1", toolName: "web_search", phase: .generating)),
			.tool(RemoteToolEvent(toolCallId: "t1", toolName: "web_search", phase: .started, args: #"{"q":"x"}"#)),
			.tool(RemoteToolEvent(toolCallId: "t1", toolName: "web_search", phase: .updated, result: "partial")),
			.tool(RemoteToolEvent(toolCallId: "t2", toolName: "read", phase: .started)),
		])
		let streaming = assistant(base.items.first)
		#expect(streaming?.tools.map(\.status) == [.running, .running])
		#expect(streaming?.tools.first?.args == #"{"q":"x"}"#)
		#expect(streaming?.tools.first?.result == "partial")
		let done = run([
			.tool(RemoteToolEvent(toolCallId: "t1", toolName: "web_search", phase: .completed, result: "200 OK", durationMs: 12)),
			.tool(RemoteToolEvent(toolCallId: "t2", toolName: "read", phase: .failed, result: "ENOENT")),
			.message(.assistantDelta("done")),
			.state(RemoteSessionState(status: .completed)),
		], from: base)
		let finished = assistant(done.items.first)
		#expect(finished?.tools.map(\.status) == [.done, .failed])
		#expect(finished?.tools.first?.durationMs == 12)
		#expect(finished?.streaming == false)
	}

	@Test func surfacesAndClearsAPendingQuestion() {
		let request = RemoteQuestionRequest(requestId: "q1", questions: [RemoteQuestionItem(question: "继续？", header: "确认", options: [RemoteQuestionOption(label: "是", description: "")], multiSelect: false)])
		let asked = run([.state(RemoteSessionState(status: .running)), .question(request)])
		#expect(asked.pendingQuestion?.requestId == "q1")
		#expect(asked.sessionState.status == .waitingInput)
		let resolved = run([.questionResolved(requestId: "q1")], from: asked)
		#expect(resolved.pendingQuestion == nil)
		#expect(resolved.sessionState.status == .running)
		#expect(run([.questionResolved(requestId: "other")], from: asked).pendingQuestion?.requestId == "q1")
	}

	@Test func marksTheTranscriptStaleOnResync() {
		let state = run([.message(.user(text: "hi", at: 1)), .state(RemoteSessionState(status: .running)), .resync])
		#expect(state.items.isEmpty)
		#expect(state.stale)
		#expect(state.sessionState.status == .running)
	}

	@Test func attachesTheErrorToTheStreamingBubble() {
		let state = run([
			.state(RemoteSessionState(status: .running)),
			.message(.assistantDelta("部分")),
			.tool(RemoteToolEvent(toolCallId: "t1", toolName: "bash", phase: .started)),
			.state(RemoteSessionState(status: .error, error: RemoteSessionError(code: "internal_error", message: "boom"))),
		])
		#expect(assistant(state.items.first)?.error == "boom")
		#expect(assistant(state.items.first)?.tools.first?.status == .failed)
	}

	@Test func continuesAPartialReplyFromAMidTurnHistorySnapshot() {
		let state = run([
			.history(entries: [
				.user(id: "u1", text: "hi", at: 1),
				.assistant(id: "a1", text: "部分", thinking: nil, toolCalls: [], at: 2, error: nil),
			], state: RemoteSessionState(status: .running)),
			.message(.assistantDelta("回复")),
			.message(.turnEnd(at: 3)),
			.state(RemoteSessionState(status: .completed)),
		])
		#expect(state.items.count == 2)
		#expect(assistant(state.items.last)?.text == "部分回复")
		#expect(assistant(state.items.last)?.streaming == false)
		let idle = run([.history(entries: [.assistant(id: "a1", text: "完", thinking: nil, toolCalls: [], at: 2, error: nil)], state: RemoteSessionState(status: .idle))])
		#expect(assistant(idle.items.last)?.streaming == false)
	}

	@Test func dropsAnEmptyStreamingBubbleWhenTheTurnEnds() {
		let state = run([.message(.assistantDelta("")), .message(.turnEnd(at: 1))])
		#expect(state.items.isEmpty)
	}
}

@Suite struct CacheAndStoreTests {
	func session(_ id: Int) -> RemoteSessionSummary {
		RemoteSessionSummary(id: "s\(id)", projectCwd: "/conv", projectName: "对话", title: "会话 \(id)", updatedAt: Double(id), status: .idle, live: false)
	}

	func exerciseCache(_ cache: SessionCache) {
		let sessions = (1 ... 60).map(session)
		cache.saveSessions("d1", Array(sessions.prefix(10)))
		cache.saveTranscript("d1", "s1", [.user(id: "u", text: "hi", at: nil)])
		#expect(cache.loadTranscript("d1", "s1")?.count == 1)
		cache.saveSessions("d1", sessions)
		let kept = cache.loadSessions("d1")
		#expect(kept.count == SessionCacheLimit.sessions)
		#expect(kept.first?.id == "s60")
		#expect(!kept.contains { $0.id == "s1" })
		#expect(cache.loadTranscript("d1", "s1") == nil)
		cache.saveTranscript("d1", "ghost", [])
		#expect(cache.loadTranscript("d1", "ghost") == nil)
		cache.saveSessions("d2", [session(2)])
		cache.clearDesktop("d1")
		#expect(cache.loadSessions("d1").isEmpty)
		#expect(cache.loadSessions("d2").count == 1)
	}

	@Test func memoryCacheKeepsTheMostRecentAndDropsTranscripts() {
		exerciseCache(MemorySessionCache())
	}

	@Test func sqliteCacheBehavesTheSameAndSurvivesReopening() throws {
		let path = FileManager.default.temporaryDirectory.appendingPathComponent("vetta-\(UUID().uuidString).sqlite").path
		defer { try? FileManager.default.removeItem(atPath: path) }
		exerciseCache(SQLiteSessionCache(path: path))
		let cache = SQLiteSessionCache(path: path)
		let turn = AssistantTurn(id: "a", text: "**hi**", thinking: "", tools: [ToolCard(toolCallId: "t", toolName: "bash", status: .done)], streaming: false, at: 3, error: nil)
		cache.saveTranscript("d2", "s2", [.assistant(turn)])
		let reopened = SQLiteSessionCache(path: path)
		#expect(reopened.loadSessions("d2").first?.title == "会话 2")
		#expect(reopened.loadTranscript("d2", "s2") == [.assistant(turn)])
	}

	@Test func pairingStorePersistsSecretsApartAndRevokesCleanly() {
		let settings = MemoryKeyValueStore()
		let secrets = MemoryKeyValueStore()
		let store = PairingStore(settings: settings, secrets: secrets)
		store.load()
		let identity = store.getIdentity()
		#expect(!store.hasCurrent)
		store.save(DesktopRecord(desktopIdentityKey: "k1", desktopName: "MacBook", pairingId: "p1", mobileSecret: "s1", lanEndpoints: ["a:1"], pairedAt: 1, lastSeenAt: 1))
		#expect(!(settings.get("vetta.desktops") ?? "").contains("s1"))
		#expect(store.getCurrent()?.mobileSecret == "s1")
		store.update("k1") {
			$0.lastEventSequence = 7
			$0.lanEndpoints = ["b:2"]
		}
		let reloaded = PairingStore(settings: settings, secrets: secrets)
		reloaded.load()
		#expect(reloaded.getIdentity().publicKey == identity.publicKey)
		#expect(reloaded.getCurrent()?.lastEventSequence == 7)
		#expect(reloaded.getCurrent()?.lanEndpoints == ["b:2"])
		reloaded.revoke("k1")
		#expect(!reloaded.hasCurrent)
		#expect(secrets.get("vetta.desktop.k1.secret") == nil)
	}
}

/// End-to-end over the fake desktop: pairing, session list, prompting with
/// streamed replies, answering a question and unpairing.
@Suite(.serialized) struct AppModelTests {
	func scriptedDesktop() -> FakeDesktop {
		let desktop = FakeDesktop()
		desktop.onHello = { _ in .approve }
		var sessions: [JSONValue] = [
			["id": "s1", "projectCwd": "/conv", "projectName": "对话", "title": "整理周报", "preview": "上周的", "updatedAt": 1_000, "status": "completed", "live": false],
		]
		desktop.onRequest = { connection, request in
			switch request.method {
			case .sessionList:
				try? connection.respond(requestId: request.requestId, success: true, payload: ["sessions": .array(sessions)])
			case .projectList:
				try? connection.respond(requestId: request.requestId, success: true, payload: ["projects": [
					["cwd": "/conv", "name": "对话", "kind": "conversation", "sessionCount": 1],
					["cwd": "/code/vetta", "name": "vetta", "kind": "project", "sessionCount": 0],
				]])
			case .sessionCreate:
				let cwd = request.payload?["projectCwd"]?.stringValue ?? "/conv"
				let created: JSONValue = ["id": "s2", "projectCwd": .string(cwd), "projectName": cwd == "/conv" ? "对话" : "vetta", "title": "", "updatedAt": 2_000, "status": "idle", "live": true]
				sessions.insert(created, at: 0)
				try? connection.respond(requestId: request.requestId, success: true, payload: ["session": created])
			case .sessionOpen:
				try? connection.respond(requestId: request.requestId, success: true, payload: ["session": sessions[0], "state": ["status": "idle"]])
			case .sessionHistory:
				try? connection.respond(requestId: request.requestId, success: true, payload: ["entries": [["kind": "user", "id": "u1", "text": "旧问题", "at": 1]], "state": ["status": "idle"]])
			case .sessionPrompt:
				try? connection.respond(requestId: request.requestId, success: true, payload: ["accepted": true])
				let sid = request.sessionId
				let text = request.payload?["text"]?.stringValue ?? ""
				_ = try? connection.emitEvent(.sessionMessage, payload: ["kind": "user", "text": .string(text), "at": 5], sessionId: sid)
				_ = try? connection.emitEvent(.sessionTool, payload: ["toolCallId": "t1", "toolName": "web_search", "phase": "completed", "args": #"{"q":"周报"}"#], sessionId: sid)
				_ = try? connection.emitEvent(.sessionMessage, payload: ["kind": "assistant_delta", "text": "好的，"], sessionId: sid)
				_ = try? connection.emitEvent(.sessionMessage, payload: ["kind": "assistant_delta", "text": "已完成"], sessionId: sid)
				_ = try? connection.emitEvent(.sessionInput, payload: ["kind": "question", "request": ["requestId": "q1", "questions": [["question": "要发邮件吗？", "header": "确认", "options": [["label": "发", "description": ""], ["label": "不发", "description": ""]]]]]], sessionId: sid)
			case .sessionRespond:
				try? connection.respond(requestId: request.requestId, success: true, payload: ["responded": true])
				_ = try? connection.emitEvent(.sessionMessage, payload: ["kind": "turn_end", "at": 9], sessionId: request.sessionId)
				_ = try? connection.emitEvent(.sessionState, payload: ["status": "completed"], sessionId: request.sessionId)
			default:
				try? connection.respond(requestId: request.requestId, success: true, payload: [:])
			}
		}
		return desktop
	}

	@Test func pairsPromptsAnswersAndUnpairs() async throws {
		let desktop = scriptedDesktop()
		var turnEnds = 0
		var platform = AppPlatform.memory(createTransport: desktop.createTransport)
		platform.onTurnEnd = { turnEnds += 1 }
		let model = AppModel(platform: platform)
		model.start()
		#expect(model.ready && !model.paired)

		let invite = PairingURI.build(RemotePairingInvite(pairingId: "pair-1234567890abcdef", mobileSecret: "secret-1234567890abcdef", desktopIdentityKey: desktop.identityKey, desktopName: "MacBook Pro", lanEndpoints: ["192.168.1.20:43117"]))
		#expect(await model.pairWithCode(invite))
		#expect(model.paired)
		#expect(model.desktop?.desktopName == "MacBook Pro")
		#expect(await eventually { model.online })
		#expect(await eventually { model.sessions.map(\.id) == ["s1"] })

		let sessionId = await model.sendPrompt(nil, "  帮我写周报 ")
		#expect(sessionId == "s2")
		#expect(await eventually { model.transcript("s2").pendingQuestion?.requestId == "q1" })
		let transcript = model.transcript("s2")
		#expect(transcript.items.count == 2)
		if case let .user(_, text, at) = transcript.items.first {
			#expect(text == "帮我写周报")
			#expect(at == 5)
		} else {
			Issue.record("expected the desktop's user bubble")
		}
		if case let .assistant(turn) = transcript.items.last {
			#expect(turn.text == "好的，已完成")
			#expect(turn.tools.map(\.toolName) == ["web_search"])
		} else {
			Issue.record("expected an assistant turn")
		}
		#expect(model.session("s2")?.status == .waitingInput)
		#expect(model.session("s2")?.title == "帮我写周报")

		await model.respond("s2", requestId: "q1", answers: [RemoteQuestionAnswer(question: "要发邮件吗？", answers: ["发"])])
		#expect(await eventually { model.transcript("s2").sessionState.status == .completed })
		#expect(model.transcript("s2").pendingQuestion == nil)
		#expect(turnEnds == 1)

		await model.openSession("s1")
		#expect(model.transcript("s1").items.count == 1)

		model.unpair()
		#expect(!model.paired)
		#expect(model.sessions.isEmpty)
		#expect(!model.link.isUsable)
	}

	@Test func startsANewSessionInTheChosenProjectAndRemembersTheProjects() async throws {
		let desktop = scriptedDesktop()
		let platform = AppPlatform.memory(createTransport: desktop.createTransport)
		let model = AppModel(platform: platform)
		model.start()
		let invite = PairingURI.build(RemotePairingInvite(pairingId: "pair-1234567890abcdef", mobileSecret: "secret-1234567890abcdef", desktopIdentityKey: desktop.identityKey, desktopName: "MacBook Pro", lanEndpoints: ["192.168.1.20:43117"]))
		#expect(await model.pairWithCode(invite))
		#expect(await eventually { model.projects.map(\.cwd) == ["/conv", "/code/vetta"] })
		#expect(model.conversationCwd == "/conv")

		let sessionId = await model.sendPrompt(nil, "跑一下测试", projectCwd: "/code/vetta")
		#expect(sessionId == "s2")
		#expect(model.session("s2")?.projectCwd == "/code/vetta")
		#expect(await eventually { model.count(.waiting) == 1 })
		let visible = SessionFilter(kind: .project).apply(model.sessions, conversationCwd: model.conversationCwd)
		#expect(visible.map(\.id) == ["s2"])

		model.unpairKeepingData()
		let relaunched = AppModel(platform: platform)
		relaunched.start()
		#expect(relaunched.conversationCwd == "/conv", "the project list survives a relaunch before the link is up")
		relaunched.unpair()
		#expect(relaunched.projects.isEmpty)
		#expect(platform.settings.get(AppModel.projectsKeyPrefix + desktop.identityKey) == nil)
	}

	@Test func reportsOfflineInsteadOfSendingAndHonoursLiveThinking() async {
		let desktop = scriptedDesktop()
		let model = AppModel(platform: .memory(createTransport: desktop.createTransport))
		model.start()
		#expect(await model.sendPrompt(nil, "hi") == nil)
		#expect(model.lastError == L10n.Common.notConnected)
		model.setPreferences { $0.liveThinking = false }
		#expect(!model.preferences.liveThinking)
	}

	@Test func restoresThePairedDesktopAndCachedSessionsOnLaunch() async {
		let desktop = scriptedDesktop()
		let platform = AppPlatform.memory(createTransport: desktop.createTransport)
		let first = AppModel(platform: platform)
		first.start()
		let invite = PairingURI.build(RemotePairingInvite(pairingId: "pair-1234567890abcdef", mobileSecret: "secret-1234567890abcdef", desktopIdentityKey: desktop.identityKey, desktopName: "MacBook Pro", lanEndpoints: ["192.168.1.20:43117"]))
		#expect(await first.pairWithCode(invite))
		#expect(await eventually { first.sessions.count == 1 })
		first.unpairKeepingData()

		let second = AppModel(platform: platform)
		second.start()
		#expect(second.paired)
		#expect(second.sessions.map(\.id) == ["s1"])
		#expect(await eventually { second.online })
	}
}

extension AppModel {
	/// Test seam: drop the live link without forgetting the desktop, like the app being killed.
	func unpairKeepingData() {
		setActive(false)
	}
}
