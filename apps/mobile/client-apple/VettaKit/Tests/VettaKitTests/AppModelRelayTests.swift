import Foundation
import Testing
@testable import VettaKit

extension AppModelTests {
	@Test func followsANewRelayWhileKeepingTheOpenChatAndRemembersIt() async throws {
		let desktop = scriptedDesktop()
		var platform = AppPlatform.memory(createTransport: desktop.createTransport)
		platform.configureManager = { $0.lanBudgetMs = 30 }
		let model = AppModel(platform: platform)
		model.start()
		defer { model.unpair() }
		let invite = PairingURI.build(RemotePairingInvite(pairingId: "pair-1234567890abcdef", mobileSecret: "secret-1234567890abcdef", desktopIdentityKey: desktop.identityKey, desktopName: "MacBook Pro", lanEndpoints: ["192.168.1.20:43117"], relayBaseUrl: "wss://relay.example"))
		#expect(await model.pairWithCode(invite))
		#expect(await eventually { model.online && !model.sessions.isEmpty })
		await model.openSession("s1")
		#expect(await model.sendPrompt("s1", "Keep this chat open") == "s1")
		#expect(await eventually { model.transcript("s1").pendingQuestion != nil })
		let before = model.transcript("s1")
		let sessionIds = model.sessions.map(\.id)
		let connection = try #require(desktop.onlineAcceptor())
		let opened = desktop.opened.count
		for relay in ["https://RELAY.example/", "file:///invalid"] {
			try connection.emitEvent(.deviceStatus, payload: ["deviceName": "MacBook Pro", "lanEndpoints": [], "relayEnabled": true, "runningSessionCount": 0, "relayBaseUrl": .string(relay)])
			let sequence = desktop.journal.lastSequence
			#expect(await eventually {
				let saved = PairingStore(settings: platform.settings, secrets: platform.secrets)
				saved.load()
				return saved.getCurrent()?.lastEventSequence == sequence
			})
			#expect(desktop.opened.count == opened, "an unchanged or invalid address must not restart the link")
			#expect(model.desktop?.relayBaseUrl == "wss://relay.example")
		}
		desktop.unreachable.insert("ws://192.168.1.20:43117")
		try await desktop.connectRelay("pair-1234567890abcdef")
		try connection.emitEvent(.deviceStatus, payload: ["deviceName": "MacBook Pro", "lanEndpoints": [], "relayEnabled": true, "runningSessionCount": 0, "relayBaseUrl": "wss://relay.mine.test"])

		#expect(await eventually { model.desktop?.relayBaseUrl == "wss://relay.mine.test" && model.link.channel == .relay })
		#expect(desktop.opened.contains { $0.hasPrefix("wss://relay.mine.test/") })
		#expect(model.sessions.map(\.id) == sessionIds)
		#expect(model.transcript("s1") == before, "changing the route must not clear the open chat")
		#expect(model.remoteDesktopTarget?.hasPrefix("wss://relay.mine.test/") == true)
		#expect(await model.respond("s1", requestId: "q1", answers: [RemoteQuestionAnswer(question: "要发邮件吗？", answers: ["不发"])]))
		#expect(await eventually { model.transcript("s1").sessionState.status == .completed })

		let saved = PairingStore(settings: platform.settings, secrets: platform.secrets)
		saved.load()
		#expect(saved.getCurrent()?.relayBaseUrl == "wss://relay.mine.test", "the new route survives relaunch")
		#expect(saved.getCurrent()?.pairingId == "pair-1234567890abcdef")
		#expect((saved.getCurrent()?.lastEventSequence ?? 0) > 0)
	}
}

@Suite struct RelayStatusTests {
	@Test func acceptsOnlyRelayUrlsAndKeepsOldDesktopCompatibility() {
		#expect(RemoteAPI.readDeviceStatus(["deviceName": "Mac"])?.relayBaseUrl == nil)
		#expect(RemoteAPI.readDeviceStatus(["deviceName": "Mac", "relayBaseUrl": "https://RELAY.example/"])?.relayBaseUrl == "wss://relay.example")
		let invalid: [JSONValue] = ["file:///tmp/relay", "", .number(1), .null]
		for value in invalid {
			#expect(RemoteAPI.readDeviceStatus(["deviceName": "Mac", "relayBaseUrl": value])?.relayBaseUrl == nil)
		}
	}
}
