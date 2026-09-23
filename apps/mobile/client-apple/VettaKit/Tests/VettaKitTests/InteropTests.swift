import Foundation
import Testing
@testable import VettaKit

/// Runs only when `scripts/interop.sh` (or a manual `interop-desktop.ts`) is
/// serving the desktop's real TypeScript LAN server and relay: proves the
/// Swift client and the desktop agree on the wire, the crypto and the flows.
nonisolated enum Interop {
	struct Info: Decodable, Sendable {
		let lanPort: Int
		let relayPort: Int
		let invite: String
		let relayOnlyInvite: String
	}

	static let info: Info? = {
		guard let path = ProcessInfo.processInfo.environment["VETTA_INTEROP_FILE"],
		      let data = FileManager.default.contents(atPath: path)
		else { return nil }
		return try? JSONDecoder().decode(Info.self, from: data)
	}()

	static let enabled = info != nil

	@MainActor static func platform() -> AppPlatform {
		AppPlatform.memory(createTransport: { url, options in WebSocketTransport(url: url, options: options) }, deviceName: "Interop iPhone")
	}
}

@Suite(.serialized, .enabled(if: Interop.enabled, "set VETTA_INTEROP_FILE via scripts/interop.sh"))
struct InteropTests {
	@Test func pairsOverTheLanAndMirrorsASessionEndToEnd() async throws {
		let info = try #require(Interop.info)
		let model = AppModel(platform: Interop.platform())
		model.start()
		#expect(await model.pairWithCode(info.invite))
		#expect(await eventually(timeoutMs: 5_000) { model.online })
		#expect(model.link.channel == .lan)
		#expect(await eventually(timeoutMs: 5_000) { model.sessions.contains { $0.id == "s-report" } })
		#expect(await eventually(timeoutMs: 5_000) { model.link.desktop?.deviceName == "Interop MacBook Pro" })

		await model.openSession("s-report")
		let history = model.transcript("s-report")
		#expect(history.items.count == 3, "a user message and two replies in a row")
		if case let .assistant(turn) = history.items[1] {
			#expect(turn.text.contains("| 模块 | 数量 |"))
			#expect(turn.tools.first?.toolName == "web_search")
		} else {
			Issue.record("expected an assistant turn in history")
		}

		let sessionId = try #require(await model.sendPrompt(nil, "帮我检查一下构建"))
		#expect(await eventually(timeoutMs: 5_000) { model.transcript(sessionId).pendingQuestion != nil })
		let streamed = model.transcript(sessionId)
		if case let .assistant(turn) = streamed.items.last {
			#expect(turn.text.contains("收到：帮我检查一下构建"))
			#expect(turn.thinking == "先确认需求，")
			#expect(turn.tools.first?.toolName == "bash")
		} else {
			Issue.record("expected a streamed assistant turn, got \(streamed.items)")
		}
		let question = try #require(streamed.pendingQuestion)
		await model.respond(sessionId, requestId: question.requestId, answers: [RemoteQuestionAnswer(question: question.questions[0].question, answers: ["继续"])])
		#expect(await eventually(timeoutMs: 5_000) { model.transcript(sessionId).sessionState.status == .completed })
		if case let .assistant(turn) = model.transcript(sessionId).items.last {
			#expect(turn.text.hasSuffix("好的，已按你的选择继续。"))
			#expect(!turn.streaming)
		}
		model.unpair()
	}

	@Test func fallsBackToTheRelayWhenTheLanIsUnreachable() async throws {
		let info = try #require(Interop.info)
		let model = AppModel(platform: Interop.platform())
		model.start()
		#expect(await model.pairWithCode(info.relayOnlyInvite))
		#expect(await eventually(timeoutMs: 12_000) { model.online })
		#expect(model.link.channel == .relay)
		#expect(await eventually(timeoutMs: 5_000) { !model.sessions.isEmpty })
		await model.openSession("s-build")
		#expect(model.transcript("s-build").items.count == 1)

		// The largest attachment the phone sends must fit one sealed frame through the real relay.
		await model.loadModels("s-report")
		#expect(model.models["s-report"]?.map(\.key) == ["anthropic/claude-opus-5", "zai/glm-5"])
		#expect(await model.configure("s-report", modelKey: "zai/glm-5", thinkingLevel: "max"))
		#expect(model.transcript("s-report").sessionState.thinkingLevel == "max")
		let largest = PromptAttachment(kind: .file, name: "largest.bin", mimeType: "application/octet-stream", data: Data((0 ..< RemoteAPI.maxUploadBytes).map { UInt8(truncatingIfNeeded: $0 &* 31) }))
		#expect(await model.sendPrompt("s-report", "看附件", attachments: [largest]) == "s-report")
		#expect(model.lastError == nil)
		#expect(await eventually(timeoutMs: 8_000) {
			if case let .assistant(turn) = model.transcript("s-report").items.last { return turn.text.contains("largest.bin \(RemoteAPI.maxUploadBytes)B") }
			return false
		})
		model.unpair()
	}

	@Test func pairsManuallyWithVerificationCodeAndCredentialHandOver() async throws {
		let info = try #require(Interop.info)
		let model = AppModel(platform: Interop.platform())
		model.start()
		var sawCode = false
		let observer = Task {
			while !Task.isCancelled {
				if case let .awaitingApproval(code, _) = model.pairing, code.count == 6 { sawCode = true }
				try? await Task.sleep(nanoseconds: 5_000_000)
			}
		}
		#expect(await model.pairManually("127.0.0.1:\(info.lanPort)"))
		observer.cancel()
		#expect(sawCode)
		#expect(model.desktop?.desktopName == "Interop MacBook Pro")
		#expect(await eventually(timeoutMs: 5_000) { model.online })
		#expect(model.link.channel == .lan)
		model.unpair()
	}

	@Test func refusesAnInviteWithAForeignIdentityKey() async throws {
		let info = try #require(Interop.info)
		var invite = try PairingURI.parse(info.invite)
		invite.desktopIdentityKey = Base64URL.encode(RemoteIdentityKeyPair.generate().publicKey)
		invite.relayBaseUrl = nil
		let model = AppModel(platform: Interop.platform())
		model.start()
		#expect(await model.pairWithCode(PairingURI.build(invite)) == false)
		#expect(model.pairing == .failed(.unauthorized) || model.pairing == .failed(.unreachable))
		#expect(!model.paired)
	}
}
