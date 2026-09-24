import Foundation
import Testing
@testable import VettaKit

@Suite(.serialized) struct RemoteConnectionTests {
	func pair(latency: Double = 1) -> (phone: RemoteConnection, desktop: RemoteConnection, phoneIdentity: RemoteIdentityKeyPair) {
		let phoneSide = FakeTransport(latencyMs: latency)
		let desktopSide = FakeTransport(latencyMs: latency)
		phoneSide.connectPeer(desktopSide)
		let phoneIdentity = RemoteIdentityKeyPair.generate()
		let desktopIdentity = RemoteIdentityKeyPair.generate()
		var phoneOptions = RemoteConnectionOptions(role: .mobile, deviceId: "phone", deviceName: "Phone", capabilities: RemoteCapabilities(chat: true, sessionRead: true), identity: phoneIdentity)
		phoneOptions.expectedPeerIdentityKey = desktopIdentity.publicKey
		phoneOptions.requestTimeoutMs = 300
		var desktopOptions = RemoteConnectionOptions(role: .desktop, deviceId: "desktop", deviceName: "Mac", capabilities: RemoteCapabilities(chat: true, sessionRead: true), identity: desktopIdentity)
		desktopOptions.handshake = .accept
		desktopOptions.expectedPeerIdentityKey = phoneIdentity.publicKey
		return (RemoteConnection(transport: phoneSide, options: phoneOptions), RemoteConnection(transport: desktopSide, options: desktopOptions), phoneIdentity)
	}

	@Test func completesTheHandshakeAndCorrelatesRequests() async throws {
		let (phone, desktop, _) = pair()
		desktop.onEvent { event in
			if case let .remoteRequest(request) = event {
				try? desktop.respond(requestId: request.requestId, success: true, payload: ["echo": request.payload ?? .null])
			}
		}
		try await desktop.connect()
		try await phone.connect()
		#expect(await eventually { phone.state == .online && desktop.state == .online })
		let result = try await phone.request(.sessionPrompt, payload: ["text": "hi"], sessionId: "s1")
		#expect(result?["echo"]?["text"]?.stringValue == "hi")
		#expect(phone.snapshot.lastRttMs != nil)
		#expect(phone.snapshot.verificationCode == desktop.snapshot.verificationCode)
	}

	@Test func timesOutUnansweredRequestsAndFailsFastWhenOffline() async throws {
		let (phone, desktop, _) = pair()
		try await desktop.connect()
		try await phone.connect()
		#expect(await eventually { phone.state == .online })
		await #expect(throws: RemoteRequestError.self) { try await phone.request(.sessionList) }
		#expect(phone.snapshot.lastErrorCode == .requestTimeout)
		phone.close()
		await #expect(throws: RemoteRequestError.self) { try await phone.request(.sessionList) }
	}

	@Test func deliversEventsInOrderAndRecoversFromAGap() async throws {
		let (phone, desktop, _) = pair()
		var received: [Int] = []
		phone.onEvent { event in
			if case let .remoteEvent(remote) = event { received.append(remote.sequence) }
		}
		try await desktop.connect()
		try await phone.connect()
		#expect(await eventually { phone.state == .online && desktop.state == .online })
		try desktop.emitEvent(.sessionState, payload: ["status": "running"], sessionId: "s")
		try desktop.emitEvent(.sessionState, payload: ["status": "idle"], sessionId: "s")
		#expect(await eventually { received == [1, 2] })
		#expect(await eventually { desktop.snapshot.lastAckSequence == 2 })
	}

	@Test func rejectsAPeerThatPresentsAnotherIdentity() async throws {
		let phoneSide = FakeTransport(latencyMs: 1)
		let desktopSide = FakeTransport(latencyMs: 1)
		phoneSide.connectPeer(desktopSide)
		var phoneOptions = RemoteConnectionOptions(role: .mobile, deviceId: "phone", deviceName: "Phone", capabilities: RemoteCapabilities(chat: true, sessionRead: true), identity: .generate())
		phoneOptions.expectedPeerIdentityKey = RemoteIdentityKeyPair.generate().publicKey
		var desktopOptions = RemoteConnectionOptions(role: .desktop, deviceId: "desktop", deviceName: "Mac", capabilities: RemoteCapabilities(chat: true, sessionRead: true), identity: .generate())
		desktopOptions.handshake = .accept
		desktopOptions.onHello = { _ in .approve }
		let phone = RemoteConnection(transport: phoneSide, options: phoneOptions)
		let desktop = RemoteConnection(transport: desktopSide, options: desktopOptions)
		try await desktop.connect()
		try await phone.connect()
		#expect(await eventually { phone.state == .failed })
		#expect(phone.snapshot.lastErrorCode == .unauthorized)
	}

	@Test func worksThroughTheRelayIncludingEarlySealedFrames() async throws {
		let relay = FakeRelay()
		let phoneIdentity = RemoteIdentityKeyPair.generate()
		let desktopIdentity = RemoteIdentityKeyPair.generate()
		var desktopOptions = RemoteConnectionOptions(role: .desktop, deviceId: "desktop", deviceName: "Mac", capabilities: RemoteCapabilities(chat: true, sessionRead: true), identity: desktopIdentity)
		desktopOptions.expectedPeerIdentityKey = phoneIdentity.publicKey
		let desktop = RemoteConnection(transport: relay.createTransport(pairingId: "room-1234567890abcd", role: .desktop), options: desktopOptions)
		var phoneOptions = RemoteConnectionOptions(role: .mobile, deviceId: "phone", deviceName: "Phone", capabilities: RemoteCapabilities(chat: true, sessionRead: true), identity: phoneIdentity)
		phoneOptions.expectedPeerIdentityKey = desktopIdentity.publicKey
		let phone = RemoteConnection(transport: relay.createTransport(pairingId: "room-1234567890abcd", role: .mobile), options: phoneOptions)
		desktop.onEvent { event in
			if case let .remoteRequest(request) = event { try? desktop.respond(requestId: request.requestId, success: true, payload: ["ok": true]) }
		}
		try await desktop.connect()
		try await phone.connect()
		#expect(await eventually { phone.state == .online && desktop.state == .online })
		let result = try await phone.request(.diagnosticsSnapshot)
		#expect(result?["ok"]?.boolValue == true)
		desktop.close()
		#expect(await eventually { phone.state != .online || phone.snapshot.pendingRequestCount == 0 })
	}
}

@Suite(.serialized) struct ChannelManagerTests {
	@Test func prefersTheLanWhenItAnswers() async {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		let manager = ChannelManager(options: ChannelManagerOptions(desktop: desktopRecord(desktop), link: link, createTransport: desktop.createTransport))
		manager.start()
		#expect(await eventually { manager.snapshot.status == .online })
		#expect(manager.snapshot.channel == .lan)
		#expect(manager.snapshot.peerOnline)
		#expect(!desktop.opened.contains { $0.contains("/v2/relay/") })
		manager.stop()
	}

	@Test func fallsBackToTheRelayThenSwitchesBackSilently() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		desktop.unreachable.insert("ws://192.168.1.20:43117")
		try await desktop.connectRelay("pair-1234567890abcdef")
		var options = ChannelManagerOptions(desktop: desktopRecord(desktop), link: link, createTransport: desktop.createTransport)
		options.lanBudgetMs = 150
		options.lanProbeIntervalMs = 300
		let manager = ChannelManager(options: options)
		var seen: [String] = []
		manager.subscribe { seen.append("\($0.status.rawValue):\($0.channel?.rawValue ?? "nil")") }
		manager.start()
		#expect(await eventually { manager.snapshot.status == .online })
		#expect(manager.snapshot.channel == .relay)
		desktop.unreachable.removeAll()
		#expect(await eventually { manager.snapshot.channel == .lan })
		#expect(manager.snapshot.status == .online)
		#expect(!seen.contains { $0.hasPrefix("offline") })
		#expect(desktop.relayDesktop?.snapshot.peerDeviceId == "phone-1")
		manager.stop()
	}

	@Test func keepsOneContinuousSequenceAcrossAChannelSwitch() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		desktop.unreachable.insert("ws://192.168.1.20:43117")
		let relayDesktop = try await desktop.connectRelay("pair-1234567890abcdef")
		var sequences: [Int] = []
		var options = ChannelManagerOptions(desktop: desktopRecord(desktop), link: link, createTransport: desktop.createTransport)
		options.lanBudgetMs = 150
		options.lanProbeIntervalMs = 300
		options.onSequence = { sequences.append($0) }
		let manager = ChannelManager(options: options)
		var names: [String] = []
		manager.onEvent { names.append("\($0.sequence):\($0.name.rawValue)") }
		manager.start()
		#expect(await eventually { manager.snapshot.channel == .relay })
		#expect(await eventually { relayDesktop.state == .online })
		try relayDesktop.emitEvent(.sessionState, payload: ["status": "running"], sessionId: "s1")
		try relayDesktop.emitEvent(.sessionMessage, payload: ["kind": "assistant_delta", "text": "a"], sessionId: "s1")
		#expect(await eventually { names == ["1:session.state", "2:session.message"] })
		desktop.unreachable.removeAll()
		#expect(await eventually { manager.snapshot.channel == .lan })
		let lan = try #require(desktop.onlineAcceptor())
		try lan.emitEvent(.sessionMessage, payload: ["kind": "assistant_delta", "text": "b"], sessionId: "s1")
		#expect(await eventually { names.count == 3 })
		#expect(names == ["1:session.state", "2:session.message", "3:session.message"])
		#expect(sequences.last == 3)
		#expect(manager.sequence == 3)
		manager.stop()
	}

	@Test func resumesFromThePersistedSequence() async {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		for index in 0 ..< 3 {
			let sequence = desktop.journal.nextSequence()
			desktop.journal.remember(RemoteEvent(eventId: "e\(index + 1)", sequence: sequence, name: .sessionState, sessionId: "s1", payload: ["status": "running"]))
		}
		let manager = ChannelManager(options: ChannelManagerOptions(desktop: desktopRecord(desktop, lastEventSequence: 1), link: link, createTransport: desktop.createTransport))
		var received: [Int] = []
		manager.onEvent { received.append($0.sequence) }
		manager.start()
		#expect(await eventually { received == [2, 3] })
		manager.stop()
	}

	@Test func rejectsRequestsWhileOfflineAndReconnectsWithBackoff() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		var options = ChannelManagerOptions(desktop: desktopRecord(desktop, relay: nil), link: link, createTransport: desktop.createTransport)
		options.lanBudgetMs = 100
		let manager = ChannelManager(options: options)
		manager.start()
		#expect(await eventually { manager.snapshot.status == .online })
		let acceptor = try #require(desktop.onlineAcceptor())
		acceptor.close()
		#expect(await eventually { manager.snapshot.status == .offline })
		await #expect(throws: LinkOfflineError.self) { try await manager.request(.sessionList) }
		#expect(await eventually(timeoutMs: 3_000) { manager.snapshot.status == .online })
		#expect(desktop.acceptors.count >= 2)
		manager.stop()
	}

	@Test func waitsForARecoveringConnectionInsteadOfFailingTheRequest() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		desktop.lanDelayMs = 40
		desktop.onRequest = { connection, request in
			try? connection.respond(requestId: request.requestId, success: true, payload: ["sessions": []])
		}
		let manager = ChannelManager(options: ChannelManagerOptions(desktop: desktopRecord(desktop), link: link, createTransport: desktop.createTransport))
		manager.start()
		#expect(await eventually { manager.snapshot.isUsable && desktop.onlineAcceptor() != nil })
		await sleep(ms: 200) // let the handshake's own resume round-trip finish first
		// Events the phone never saw (e.g. delivered to the pairing connection), then a live one: a gap.
		for index in 1 ... 2 {
			let sequence = desktop.journal.nextSequence()
			desktop.journal.remember(RemoteEvent(eventId: "missed-\(index)", sequence: sequence, name: .sessionState, sessionId: "s1", payload: ["status": "running"]))
		}
		try desktop.onlineAcceptor()!.emitEvent(.deviceStatus, payload: ["deviceName": "MacBook Pro", "lanEndpoints": ["192.168.1.20:43117"], "relayEnabled": false, "runningSessionCount": 0])
		var received: [Int] = []
		manager.onEvent { received.append($0.sequence) }
		#expect(await eventually { manager.activeConnectionState == .recovering })
		let result = try await manager.request(.sessionList)
		#expect(result?["sessions"] != nil)
		#expect(await eventually { received == [1, 2, 3] })
		manager.stop()
	}

	@Test func updatesCachedLanEndpointsFromDeviceStatus() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		var endpoints: [[String]] = []
		var options = ChannelManagerOptions(desktop: desktopRecord(desktop), link: link, createTransport: desktop.createTransport)
		options.onLanEndpoints = { endpoints.append($0) }
		let manager = ChannelManager(options: options)
		manager.start()
		#expect(await eventually { manager.snapshot.status == .online && desktop.onlineAcceptor() != nil })
		try desktop.onlineAcceptor()!.emitEvent(.deviceStatus, payload: [
			"deviceName": "MacBook Pro",
			"lanEndpoints": ["10.0.0.5:43117"],
			"relayEnabled": true,
			"runningSessionCount": 2,
		])
		#expect(await eventually { endpoints == [["10.0.0.5:43117"]] })
		#expect(manager.snapshot.desktop?.runningSessionCount == 2)
		manager.stop()
	}
}

@Suite(.serialized) struct PairingFlowTests {
	func invite(_ desktop: FakeDesktop, lan: [String] = ["192.168.1.20:43117"], relay: String? = nil) -> String {
		PairingURI.build(RemotePairingInvite(pairingId: "pair-1234567890abcdef", mobileSecret: "secret-1234567890abcdef", desktopIdentityKey: desktop.identityKey, desktopName: "MacBook Pro", lanEndpoints: lan, relayBaseUrl: relay))
	}

	@Test func pairsFromAScannedCodeOverTheLan() async {
		let desktop = FakeDesktop()
		desktop.onHello = { _ in .approve }
		var phases: [PairingPhase] = []
		let flow = PairingFlow(options: PairingFlowOptions(link: makeLink(), createTransport: desktop.createTransport) { phases.append($0) })
		let record = await flow.pairWithCode(invite(desktop))
		#expect(record?.desktopIdentityKey == desktop.identityKey)
		#expect(record?.desktopName == "MacBook Pro")
		#expect(record?.mobileSecret == "secret-1234567890abcdef")
		#expect(record?.lanEndpoints == ["192.168.1.20:43117"])
		#expect(record?.lastEventSequence == 0)
		#expect(phases.count == 2)
		#expect(phases.first == .connecting(via: .lan))
		if case .paired = phases.last {} else { Issue.record("expected paired") }
	}

	@Test func fallsBackToTheRelayFromTheInvite() async throws {
		let desktop = FakeDesktop()
		desktop.onHello = { _ in .approve }
		desktop.unreachable.insert("ws://192.168.1.20:43117")
		try await desktop.connectRelay("pair-1234567890abcdef")
		var phases: [PairingPhase] = []
		var options = PairingFlowOptions(link: makeLink(), createTransport: desktop.createTransport) { phases.append($0) }
		options.timeoutMs = 100
		let record = await PairingFlow(options: options).pairWithCode(invite(desktop, relay: "wss://relay.example"))
		#expect(record?.relayBaseUrl == "wss://relay.example")
		#expect(phases.filter(\.isConnecting) == [.connecting(via: .lan), .connecting(via: .relay)])
	}

	@Test func rejectsForeignCodesAndImpostors() async {
		let desktop = FakeDesktop()
		desktop.onHello = { _ in .approve }
		var phases: [PairingPhase] = []
		var options = PairingFlowOptions(link: makeLink(), createTransport: desktop.createTransport) { phases.append($0) }
		options.timeoutMs = 100
		#expect(await PairingFlow(options: options).pairWithCode("https://example.com") == nil)
		#expect(phases.last == .failed(.invalidCode))
		let impostor = FakeDesktop()
		impostor.onHello = { _ in .approve }
		options.createTransport = impostor.createTransport
		#expect(await PairingFlow(options: options).pairWithCode(invite(desktop)) == nil)
		#expect(phases.last == .failed(.unauthorized))
	}

	@Test func walksTheManualPath() async throws {
		var approve: CheckedContinuation<Bool, Never>?
		let desktop = FakeDesktop()
		desktop.onHello = { _ in
			.pending(approval: { await withCheckedContinuation { approve = $0 } })
		}
		var phases: [PairingPhase] = []
		let flow = PairingFlow(options: PairingFlowOptions(link: makeLink(), createTransport: desktop.createTransport) { phases.append($0) })
		let pairing = Task { await flow.pairManually("192.168.1.20:43117") }
		#expect(await eventually { approve != nil })
		guard case let .awaitingApproval(code, _) = phases.last else {
			Issue.record("expected awaiting approval, got \(phases)")
			return
		}
		#expect(code.count == 6 && code.allSatisfy(\.isNumber))
		let acceptor = try #require(desktop.acceptors.first)
		#expect(acceptor.snapshot.verificationCode == code)
		#expect(desktop.opened.first == "ws://192.168.1.20:43117/v2/lan/pair")
		approve?.resume(returning: true)
		#expect(await eventually { acceptor.state == .online })
		try acceptor.emitEvent(.devicePaired, payload: [
			"pairingId": "pair-manual-1234567890",
			"mobileSecret": "secret-manual-1234567890",
			"desktopName": "MacBook Pro",
			"lanEndpoints": ["192.168.1.20:43117", "10.0.0.5:43117"],
			"relayBaseUrl": "wss://relay.example",
		])
		let record = await pairing.value
		#expect(record?.desktopIdentityKey == desktop.identityKey)
		#expect(record?.pairingId == "pair-manual-1234567890")
		#expect(record?.mobileSecret == "secret-manual-1234567890")
		#expect(record?.lanEndpoints == ["192.168.1.20:43117", "10.0.0.5:43117"])
		#expect(record?.relayBaseUrl == "wss://relay.example")
		if case .paired = phases.last {} else { Issue.record("expected paired") }
	}

	@Test func reportsRejectionAndInvalidEndpoints() async {
		let desktop = FakeDesktop()
		desktop.onHello = { _ in .pending(approval: { false }) }
		var phases: [PairingPhase] = []
		var options = PairingFlowOptions(link: makeLink(), createTransport: desktop.createTransport) { phases.append($0) }
		options.timeoutMs = 200
		let flow = PairingFlow(options: options)
		#expect(await flow.pairManually("192.168.1.20:43117") == nil)
		#expect(phases.last == .failed(.rejected))
		#expect(await flow.pairManually("not an address") == nil)
		#expect(phases.last == .failed(.invalidEndpoint))
	}
}
