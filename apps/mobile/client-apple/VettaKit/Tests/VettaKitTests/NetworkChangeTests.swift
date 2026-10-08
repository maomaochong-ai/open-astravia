import Foundation
import Testing
@testable import VettaKit

/// The phone moved to another network (Wi-Fi to cellular, say): the link moves with it at once
/// instead of waiting for a keepalive to notice the old sockets are gone.
@Suite(.serialized) struct NetworkChangeTests {
	private let viewer = "wss://relay.example/v2/desktop/pair-1234567890abcdef/viewer#pairing=secret"
	private let lan = "ws://192.168.1.20:43117"

	@Test func onlyANewWayOutCountsAsAChange() {
		let wifi = NetworkRoute(satisfied: true, interfaces: ["wifi"])
		let cellular = NetworkRoute(satisfied: true, interfaces: ["cellular"])
		let none = NetworkRoute(satisfied: false, interfaces: [])
		#expect(!wifi.isChange(from: nil), "the first reading is where we start")
		#expect(!wifi.isChange(from: wifi))
		#expect(!NetworkRoute(satisfied: true, interfaces: ["cellular", "wifi"]).isChange(from: NetworkRoute(satisfied: true, interfaces: ["wifi", "cellular"])))
		#expect(cellular.isChange(from: wifi))
		#expect(wifi.isChange(from: none), "back online")
		#expect(!none.isChange(from: wifi), "nowhere to reconnect to")
	}

	@Test func movesTheLanLinkToAFreshConnectionWithoutGoingOffline() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		let manager = ChannelManager(options: ChannelManagerOptions(desktop: desktopRecord(desktop), link: link, createTransport: desktop.createTransport))
		var seen: [LinkStatus] = []
		manager.subscribe { seen.append($0.status) }
		manager.start()
		#expect(await eventually { manager.snapshot.channel == .lan })
		let old = try #require(desktop.onlineAcceptor())
		seen.removeAll()

		manager.networkChanged()
		#expect(await eventually { desktop.acceptors.count == 2 && old.state != .online })
		#expect(manager.snapshot.channel == .lan && manager.snapshot.isUsable)
		#expect(seen.allSatisfy { $0 == .online }, "\(seen)")
		manager.stop()
	}

	@Test func movesFromTheRelayToTheLanThatJustBecameReachable() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		desktop.unreachable.insert(lan)
		try await desktop.connectRelay("pair-1234567890abcdef")
		var options = ChannelManagerOptions(desktop: desktopRecord(desktop), link: link, createTransport: desktop.createTransport)
		options.lanBudgetMs = 150
		let manager = ChannelManager(options: options)
		manager.start()
		#expect(await eventually { manager.snapshot.channel == .relay })

		desktop.unreachable.removeAll()
		manager.networkChanged()
		#expect(await eventually(timeoutMs: 1_000) { manager.snapshot.channel == .lan }, "well before the 20 s LAN probe")
		manager.stop()
	}

	@Test func rebuildsTheStandbyBehindP2p() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		var options = ChannelManagerOptions(desktop: desktopRecord(desktop), link: link, createTransport: desktop.createTransport)
		options.p2pTarget = viewer
		options.createP2pTransport = { target in
			desktop.createTransport("p2p:\(target)", TransportOptions(pairingSecret: "secret-1234567890abcdef"))
		}
		let manager = ChannelManager(options: options)
		manager.start()
		#expect(await eventually { manager.snapshot.channel == .lan })
		let standby = try #require(desktop.onlineAcceptor())
		try standby.emitEvent(.deviceStatus, payload: .object(["deviceName": "MacBook Pro", "lanEndpoints": ["192.168.1.20:43117"], "screen": true]))
		#expect(await eventually { manager.snapshot.channel == .p2p })
		let count = desktop.acceptors.count

		manager.networkChanged()
		#expect(await eventually { desktop.acceptors.count == count + 1 && standby.state != .online })
		#expect(manager.snapshot.channel == .p2p)
		manager.stop()
	}

	@Test func reconnectsAtOnceInsteadOfWaitingOutTheBackoff() async throws {
		let link = makeLink()
		let desktop = FakeDesktop()
		desktop.mobileIdentityKey = link.identity.publicKey
		desktop.unreachable.insert(lan)
		var options = ChannelManagerOptions(desktop: desktopRecord(desktop, relay: nil), link: link, createTransport: desktop.createTransport)
		options.lanBudgetMs = 50
		let manager = ChannelManager(options: options)
		manager.start()
		// Fail twice so the next try is a few seconds out.
		#expect(await eventually { manager.snapshot.reconnectAttempt >= 2 })

		desktop.unreachable.removeAll()
		manager.networkChanged()
		#expect(await eventually(timeoutMs: 500) { manager.snapshot.isUsable })
		manager.stop()
	}
}
