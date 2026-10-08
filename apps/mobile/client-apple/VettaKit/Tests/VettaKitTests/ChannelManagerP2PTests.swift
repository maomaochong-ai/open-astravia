import Foundation
import Testing
@testable import VettaKit

/// The upgrade from the LAN or relay to the WebRTC control channel (ADR-0135, ADR-0140).
@Suite(.serialized) struct ChannelManagerP2PTests {
	private let viewer = "wss://relay.example/v2/desktop/pair-1234567890abcdef/viewer#pairing=secret"

	private func deviceStatus(screen: Bool) -> JSONValue {
		var status: [String: JSONValue] = [
			"deviceName": "MacBook Pro", "lanEndpoints": ["192.168.1.20:43117"], "relayEnabled": true, "runningSessionCount": 0,
		]
		if screen { status["screen"] = true }
		return .object(status)
	}

	/// A manager whose P2P channel reaches the fake desktop like a LAN socket does.
	private func manager(_ desktop: FakeDesktop, link: LinkIdentity, p2pReachable: @escaping () -> Bool = { true }) -> (ChannelManager, () -> [String]) {
		var targets: [String] = []
		var options = ChannelManagerOptions(desktop: desktopRecord(desktop), link: link, createTransport: desktop.createTransport)
		options.p2pTarget = viewer
		options.p2pTimeoutMs = 300
		options.p2pProbeIntervalMs = 200
		options.standbyRetryMs = 100
		options.createP2pTransport = { target in
			targets.append(target)
			if !p2pReachable() { return DeadTransport() }
			return desktop.createTransport("p2p:\(target)", TransportOptions(pairingSecret: "secret-1234567890abcdef"))
		}
		return (ChannelManager(options: options), { targets })
	}

	@Test func upgradesToP2pOnceTheDesktopSaysItCapturesOnDemand() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		let (manager, targets) = manager(desktop, link: link)
		manager.start()
		#expect(await eventually { manager.snapshot.channel == .lan })
		await sleep(ms: 100)
		#expect(targets().isEmpty, "no P2P before the desktop says what it is")

		try #require(desktop.onlineAcceptor()).emitEvent(.deviceStatus, payload: deviceStatus(screen: true))
		#expect(await eventually { manager.snapshot.channel == .p2p })
		#expect(targets() == [viewer])
		#expect(manager.snapshot.isUsable)
		manager.stop()
	}

	@Test func staysOffP2pWithADesktopThatWouldStreamItsScreenTheWholeTime() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		let (manager, targets) = manager(desktop, link: link)
		manager.start()
		#expect(await eventually { manager.snapshot.channel == .lan })
		try #require(desktop.onlineAcceptor()).emitEvent(.deviceStatus, payload: deviceStatus(screen: false))
		#expect(await eventually { manager.snapshot.desktop != nil })
		manager.refresh()
		await sleep(ms: 300)
		#expect(targets().isEmpty)
		#expect(manager.snapshot.channel == .lan)
		manager.stop()
	}

	@Test func declaresThatItSubscribesToTheScreen() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		var hellos: [RemoteHello] = []
		desktop.onHello = { hello in
			hellos.append(hello)
			return .approve
		}
		let (manager, _) = manager(desktop, link: link)
		manager.start()
		#expect(await eventually { manager.snapshot.channel == .lan })
		#expect(hellos.first?.capabilities.screen == true)
		manager.stop()
	}

	@Test func closesP2pInTheBackgroundAndUpgradesAgainInTheForeground() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		let (manager, targets) = manager(desktop, link: link)
		manager.start()
		#expect(await eventually { manager.snapshot.channel == .lan })
		try #require(desktop.onlineAcceptor()).emitEvent(.deviceStatus, payload: deviceStatus(screen: true))
		#expect(await eventually { manager.snapshot.channel == .p2p })

		manager.setForeground(false)
		#expect(manager.snapshot.channel != .p2p, "the P2P link closes at once")
		#expect(await eventually { manager.snapshot.channel == .lan })
		await sleep(ms: 300)
		#expect(targets().count == 1, "no P2P attempt in the background")

		manager.setForeground(true)
		#expect(await eventually { manager.snapshot.channel == .p2p })
		#expect(targets().count == 2)
		manager.stop()
	}

	@Test func reconnectsWithoutP2pWhenWokenInTheBackground() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		var options = ChannelManagerOptions(desktop: desktopRecord(desktop, relay: nil), link: link, createTransport: desktop.createTransport)
		options.lanBudgetMs = 100
		options.p2pTarget = viewer
		var attempts = 0
		options.createP2pTransport = { _ in
			attempts += 1
			return DeadTransport()
		}
		let manager = ChannelManager(options: options)
		manager.setForeground(false)
		manager.start()
		#expect(await eventually { manager.snapshot.channel == .lan })
		try #require(desktop.onlineAcceptor()).emitEvent(.deviceStatus, payload: deviceStatus(screen: true))
		#expect(await eventually { manager.snapshot.desktop?.screen == true })
		manager.refresh()
		await sleep(ms: 200)
		#expect(attempts == 0, "a background refresh stays on the LAN or relay")
		#expect(manager.snapshot.isUsable)
		manager.stop()
	}

	@Test func keepsTheLanWhenP2pCannotConnectAndTriesAgainLater() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		var reachable = false
		let (manager, targets) = manager(desktop, link: link, p2pReachable: { reachable })
		var seen: [String] = []
		manager.subscribe { seen.append($0.status.rawValue) }
		manager.start()
		#expect(await eventually { manager.snapshot.channel == .lan })
		seen.removeAll()
		try #require(desktop.onlineAcceptor()).emitEvent(.deviceStatus, payload: deviceStatus(screen: true))
		#expect(await eventually { targets().count >= 2 })
		#expect(manager.snapshot.channel == .lan)
		#expect(!seen.contains("offline"), "a failed upgrade never takes the link down")

		reachable = true
		#expect(await eventually { manager.snapshot.channel == .p2p })
		manager.stop()
	}

	@Test func fallsBackWhenTheP2pLinkDrops() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		var reachable = true
		let (manager, _) = manager(desktop, link: link, p2pReachable: { reachable })
		manager.start()
		#expect(await eventually { manager.snapshot.channel == .lan })
		try #require(desktop.onlineAcceptor()).emitEvent(.deviceStatus, payload: deviceStatus(screen: true))
		#expect(await eventually { manager.snapshot.channel == .p2p })

		reachable = false
		desktop.acceptors.last?.close()
		#expect(await eventually(timeoutMs: 4_000) { manager.snapshot.channel == .lan && manager.snapshot.isUsable })
		manager.stop()
	}

	@Test func aDroppedP2pLinkNeverShowsTheDesktopOffline() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		var reachable = true
		let (manager, _) = manager(desktop, link: link, p2pReachable: { reachable })
		var seen: [LinkIndicator] = []
		manager.subscribe { seen.append(LinkIndicator($0)) }
		manager.start()
		#expect(await eventually { manager.snapshot.channel == .lan })
		try #require(desktop.onlineAcceptor()).emitEvent(.deviceStatus, payload: deviceStatus(screen: true))
		#expect(await eventually { manager.snapshot.channel == .p2p })
		seen.removeAll()

		reachable = false
		desktop.acceptors.last?.close()
		#expect(await eventually(timeoutMs: 4_000) { manager.snapshot.channel == .lan && manager.snapshot.isUsable })
		#expect(!seen.contains(.offline), "falling back from P2P is not a disconnect: \(seen)")
		manager.stop()
	}

	@Test func goingToTheBackgroundOnP2pNeverShowsTheDesktopOffline() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		let (manager, _) = manager(desktop, link: link)
		var seen: [LinkIndicator] = []
		manager.subscribe { seen.append(LinkIndicator($0)) }
		manager.start()
		#expect(await eventually { manager.snapshot.channel == .lan })
		try #require(desktop.onlineAcceptor()).emitEvent(.deviceStatus, payload: deviceStatus(screen: true))
		#expect(await eventually { manager.snapshot.channel == .p2p })
		seen.removeAll()

		manager.setForeground(false)
		#expect(await eventually { manager.snapshot.channel == .lan })
		#expect(!seen.contains(.offline), "closing P2P in the background is not a disconnect: \(seen)")
		manager.stop()
	}

	@Test func keepsTheLanAsAStandbyWhileOnP2p() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		let (manager, _) = manager(desktop, link: link)
		manager.start()
		#expect(await eventually { manager.snapshot.channel == .lan })
		let lan = try #require(desktop.onlineAcceptor())
		try lan.emitEvent(.deviceStatus, payload: deviceStatus(screen: true))
		#expect(await eventually { manager.snapshot.channel == .p2p })
		await sleep(ms: 100)
		#expect(lan.state == .online, "the LAN stays up behind P2P")
		manager.stop()
	}

	@Test func aDroppedP2pLinkHandsOverToTheStandbyWithoutReconnecting() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		var reachable = true
		let (manager, _) = manager(desktop, link: link, p2pReachable: { reachable })
		var seen: [LinkSnapshot] = []
		manager.subscribe { seen.append($0) }
		manager.start()
		#expect(await eventually { manager.snapshot.channel == .lan })
		let lan = try #require(desktop.onlineAcceptor())
		try lan.emitEvent(.deviceStatus, payload: deviceStatus(screen: true))
		#expect(await eventually { manager.snapshot.channel == .p2p })
		let p2p = try #require(desktop.acceptors.last)
		var received: [Int] = []
		manager.onEvent { received.append($0.sequence) }
		try p2p.emitEvent(.sessionList, payload: .object([:]))
		#expect(await eventually { received.count == 1 })
		// Sent over P2P as it died, so never arrived: the standby must catch it up.
		let lost = RemoteEvent(eventId: "desktop-1-event-lost", sequence: desktop.journal.nextSequence(), name: .sessionList, sessionId: nil, payload: .object([:]))
		desktop.journal.remember(lost)
		let opened = desktop.opened.count
		seen.removeAll()

		reachable = false
		p2p.close()
		#expect(await eventually { manager.snapshot.channel == .lan })
		#expect(seen.allSatisfy { $0.status == .online }, "the switch never leaves the link: \(seen.map(\.status))")
		#expect(desktop.opened.count == opened, "no new LAN connection")
		#expect(await eventually { received.contains(lost.sequence) }, "what P2P lost is replayed on the LAN")
		try lan.emitEvent(.sessionList, payload: .object([:]))
		#expect(await eventually { received.count == 3 })
		#expect(received == received.sorted() && Set(received).count == 3)
		manager.stop()
	}

	@Test func rebuildsTheStandbyWhenItDrops() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		let (manager, _) = manager(desktop, link: link)
		manager.start()
		#expect(await eventually { manager.snapshot.channel == .lan })
		let lan = try #require(desktop.onlineAcceptor())
		try lan.emitEvent(.deviceStatus, payload: deviceStatus(screen: true))
		#expect(await eventually { manager.snapshot.channel == .p2p })
		let opened = desktop.opened.count

		lan.close()
		#expect(await eventually { desktop.opened.count > opened }, "a new standby is opened")
		#expect(manager.snapshot.channel == .p2p)
		manager.stop()
	}

	@Test func triesP2pLessOftenWhileItKeepsFailingAndAfreshOnANewNetwork() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		var options = ChannelManagerOptions(desktop: desktopRecord(desktop), link: link, createTransport: desktop.createTransport)
		options.p2pTarget = viewer
		options.p2pTimeoutMs = 50
		options.p2pProbeIntervalMs = 100
		var attempts: [Double] = []
		options.createP2pTransport = { _ in
			attempts.append(WallClock.nowMs())
			return DeadTransport()
		}
		let manager = ChannelManager(options: options)
		manager.start()
		#expect(await eventually { manager.snapshot.channel == .lan })
		try #require(desktop.onlineAcceptor()).emitEvent(.deviceStatus, payload: deviceStatus(screen: true))
		#expect(await eventually { attempts.count == 4 })
		let gaps = zip(attempts.dropFirst(), attempts).map { $0 - $1 }
		#expect(gaps[1] > gaps[0] * 1.5 && gaps[2] > gaps[1] * 1.5, "each failure waits longer: \(gaps)")

		// Waiting out the next, longest gap would take ~850 ms; a new network tries at once.
		let before = attempts.count
		manager.networkChanged()
		#expect(await eventually(timeoutMs: 300) { attempts.count > before })
		manager.stop()
	}

	@Test func buildsTheViewerUrlWithTheSecretInTheFragment() {
		#expect(PairingURI.desktopViewerUrl(relayBaseUrl: "wss://relay.example", pairingId: "pair-1", mobileSecret: "a+b/c")
			== "wss://relay.example/v2/desktop/pair-1/viewer#pairing=a%2Bb%2Fc")
		#expect(RemoteDesktopProtocol.splitTarget(PairingURI.desktopViewerUrl(relayBaseUrl: "wss://r", pairingId: "p", mobileSecret: "a+b/c")).token == "a+b/c")
	}

	@Test func configuresOneScreenTargetForTheLinkAndItsViewer() {
		let desktop = FakeDesktop()
		let record = desktopRecord(desktop)
		let options = ChannelManagerOptions(desktop: record, link: makeLink(), createTransport: desktop.createTransport)
		#expect(options.p2pTarget == PairingURI.desktopViewerUrl(relayBaseUrl: "wss://relay.example", pairingId: record.pairingId, mobileSecret: record.mobileSecret))
		for relay in [nil, ""] as [String?] {
			let local = ChannelManagerOptions(desktop: desktopRecord(desktop, relay: relay), link: makeLink(), createTransport: desktop.createTransport)
			#expect(local.p2pTarget == nil)
		}
	}
}
