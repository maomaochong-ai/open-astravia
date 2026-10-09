import Foundation
import Testing
@testable import VettaKit

@Suite(.serialized) struct RemoteStreamStatsTests {
	typealias Entry = RemoteStreamStats.Entry
	private let wifi = [RemoteNetworkInterface(address: "192.168.16.2", prefixLength: 20)]

	private func sample(local: [String: JSONValue] = ["candidateType": "host", "address": "192.168.16.2", "networkType": "wifi"],
		remote: [String: JSONValue] = ["candidateType": "host", "address": "192.168.31.200"],
		jitter: Double = 1, frames: Double = 100, decode: Double = 0.5) -> [Entry] {
		[
			Entry(id: "L", type: "local-candidate", values: local),
			Entry(id: "R", type: "remote-candidate", values: remote),
			Entry(id: "P", type: "candidate-pair", values: ["state": "succeeded", "nominated": true, "currentRoundTripTime": 0.008, "localCandidateId": "L", "remoteCandidateId": "R"]),
			Entry(id: "T", type: "transport", values: ["selectedCandidatePairId": "P", "iceState": "connected"]),
			Entry(id: "V", type: "inbound-rtp", values: ["kind": "video", "transportId": "T", "framesPerSecond": 60,
				"frameWidth": 2560, "frameHeight": 1600, "jitterBufferDelay": .number(jitter), "jitterBufferEmittedCount": .number(frames),
				"totalDecodeTime": .number(decode), "framesDecoded": .number(frames)]),
		]
	}

	@Test func classifiesTheSelectedAddressAndInterfaceInsteadOfHostCandidateType() {
		let cases: [(String, String, String, String, Int, RemoteStreamStats.Route)] = [
			("wifi", "192.168.16.2", "192.168.31.200", "192.168.16.2", 20, .lan),
			("wifi", "192.168.16.2", "192.168.32.1", "192.168.16.2", 20, .direct),
			("ethernet", "192.168.16.2", "203.0.113.8", "192.168.16.2", 20, .internet),
			("cellular", "2001:db8:1::2", "2001:db8:2::3", "2001:db8:1::2", 64, .internet),
			("cellular", "10.1.2.3", "10.1.2.4", "10.1.2.3", 24, .internet),
			("wifi", "2001:db8:1::2", "2001:0db8:0001:0:0:0:0:3", "2001:db8:1::2", 64, .lan),
			("wifi", "2001:db8:1::2", "2001:db8:2::3", "2001:db8:1::2", 64, .internet),
			("wifi", "fe80::2", "fe80::3", "fe80::2%en0", 64, .lan),
			("wifi", "::ffff:192.168.16.2", "::ffff:192.168.31.200", "192.168.16.2", 20, .lan),
			("vpn", "10.1.2.3", "10.1.2.4", "10.1.2.3", 24, .vpn),
			("unknown", "192.168.16.2", "192.168.31.200", "192.168.16.2", 20, .direct),
			("wifi", "192.168.16.2", "peer.local", "192.168.16.2", 20, .direct),
			("wifi", "192.168.16.2", "203.0.113.8", "192.168.16.2", 0, .direct),
		]
		for (network, local, remote, interface, prefix, expected) in cases {
			let report = sample(local: ["candidateType": "host", "address": .string(local), "networkType": .string(network)],
				remote: ["candidateType": "host", "address": .string(remote)])
			let result = RemoteStreamStats.read(report, previous: nil, interfaces: [.init(address: interface, prefixLength: prefix)])
			#expect(result.stats.route == expected, "network=\(network), expected=\(expected)")
		}
		#expect(RemoteStreamStats.read(sample(), previous: nil, interfaces: []).stats.route == .direct)
	}

	@Test func usesNatBaseAddressAndVpnEvidenceAndRecognizesRelay() {
		let local: [String: JSONValue] = ["candidateType": "srflx", "address": "198.51.100.2", "relatedAddress": "192.168.16.2", "networkType": "wifi"]
		#expect(RemoteStreamStats.read(sample(local: local, remote: ["candidateType": "host", "address": "203.0.113.8"]), previous: nil, interfaces: wifi).stats.route == .internet)
		#expect(RemoteStreamStats.read(sample(local: local, remote: ["candidateType": "srflx", "address": "198.51.100.2"]), previous: nil, interfaces: wifi).stats.route == .direct)
		#expect(RemoteStreamStats.read(sample(local: ["candidateType": "host", "networkAdapterType": "wifi", "vpn": true]), previous: nil, interfaces: wifi).stats.route == .vpn)
		#expect(RemoteStreamStats.read(sample(), previous: nil, interfaces: [.init(address: "192.168.16.2", prefixLength: 20, isTunnel: true)]).stats.route == .vpn)
		for relayIsLocal in [true, false] {
			let report = relayIsLocal ? sample(local: ["candidateType": "relay"]) : sample(remote: ["candidateType": "relay"])
			#expect(RemoteStreamStats.read(report, previous: nil, interfaces: wifi).stats.route == .relayed)
		}
	}

	@Test func labelsFollowTheVideoTransportThroughLanCellularVpnAndDisconnect() {
		L10n.pin(language: "zh-Hans")
		defer { L10n.pin(language: nil) }
		let first = RemoteStreamStats.read(sample(), previous: nil, interfaces: wifi)
		#expect(first.stats.summary.hasPrefix("局域网直连"))
		var report = sample().filter { $0.id != "T" }
		// The old nominated LAN pair remains, and another transport still selects it.
		report += [Entry(id: "OldTransport", type: "transport", values: ["selectedCandidatePairId": "P"]),
			Entry(id: "L2", type: "local-candidate", values: ["candidateType": "host", "networkType": "cellular", "address": "2001:db8:1::1"]),
			Entry(id: "P2", type: "candidate-pair", values: ["state": "succeeded", "localCandidateId": "L2", "remoteCandidateId": "R", "currentRoundTripTime": 0.045]),
			Entry(id: "T", type: "transport", values: ["selectedCandidatePairId": "P2", "iceState": "connected"])]
		let second = RemoteStreamStats.read(report.reversed(), previous: first.totals, interfaces: wifi)
		#expect(second.stats.summary.hasPrefix("公网直连 · 延迟 45 ms"))
		#expect(second.stats.roundTripMs == 45)
		report = report.map { $0.id == "L2" ? Entry(id: "L2", type: "local-candidate", values: ["candidateType": "host", "vpn": true]) : $0 }
		#expect(RemoteStreamStats.read(report, previous: second.totals, interfaces: wifi).stats.summary.hasPrefix("VPN 直连"))
		for values: [String: JSONValue] in [[:], ["selectedCandidatePairId": "missing"], ["selectedCandidatePairId": "P2", "iceState": "disconnected"]] {
			let changed = report.map { $0.id == "T" ? Entry(id: "T", type: "transport", values: values) : $0 }
			let stats = RemoteStreamStats.read(changed, previous: nil, interfaces: wifi).stats
			#expect(stats.route == nil)
			#expect(stats.roundTripMs == nil, "never reuse an old nominated pair when selection disappears")
		}
	}

	@Test func preservesFrameStatisticsAndResetsAveragesOnCounterReset() {
		let first = RemoteStreamStats.read(sample(), previous: nil, interfaces: wifi)
		#expect(first.stats.roundTripMs == 8)
		#expect(first.stats.framesPerSecond == 60)
		#expect(first.stats.frameWidth == 2560 && first.stats.frameHeight == 1600)
		#expect(first.stats.decodeMs == nil && first.stats.jitterBufferMs == nil)
		let second = RemoteStreamStats.read(sample(jitter: 2.2, frames: 160, decode: 0.8), previous: first.totals, interfaces: wifi)
		#expect(abs((second.stats.pictureDelayMs ?? 0) - 29) < 0.001)
		let reset = RemoteStreamStats.read(sample(jitter: 0.1, frames: 1, decode: 0.1), previous: second.totals, interfaces: wifi)
		#expect(reset.stats.decodeMs == nil && reset.stats.jitterBufferMs == nil)
	}

	@Test func neverGuessesFromUnselectedFailedOrAmbiguousCandidates() {
		let original = sample()
		for report in [
			original.filter { $0.id != "T" },
			original.filter { $0.id != "P" },
			original.map { $0.id == "P" ? Entry(id: "P", type: "candidate-pair", values: ["state": "failed", "nominated": true]) : $0 },
			original.filter { $0.id != "V" } + [Entry(id: "T2", type: "transport", values: ["selectedCandidatePairId": "P"])],
		] {
			let stats = RemoteStreamStats.read(report, previous: nil, interfaces: wifi).stats
			#expect(stats.route == nil && stats.roundTripMs == nil)
		}
		#expect(RemoteStreamStats.read(original.filter { $0.id != "V" }, previous: nil, interfaces: wifi).stats.route == .lan)
		#expect(RemoteStreamStats.read(original, previous: nil, interfaces: [.init(address: "192.168.99.2", prefixLength: 24)]).stats.route == .direct)
		#expect(RemoteStreamStats.read(original, previous: nil, interfaces: wifi + [.init(address: "192.168.16.2", prefixLength: 20, isTunnel: true)]).stats.route == .direct)
		#expect(RemoteStreamStats.read(sample(local: ["candidateType": "host", "networkType": "unknown", "networkAdapterType": "cellular5g"]), previous: nil, interfaces: wifi).stats.route == .internet)
		#expect(RemoteStreamStats.read(sample(local: ["candidateType": "unknown"]), previous: nil, interfaces: wifi).stats.route == nil)
	}

	@Test func validatesMasksAndNumericAddressesWithoutGuessingPrefixes() {
		#expect(RemoteNetworkInterface(address: "192.168.16.2", netmask: "255.255.240.0")?.prefixLength == 20)
		#expect(RemoteNetworkInterface(address: "2001:db8::1", netmask: "ffff:ffff:ffff:ffff::")?.prefixLength == 64)
		#expect(RemoteNetworkInterface(address: "192.168.16.2", netmask: "255.0.255.0") == nil)
		#expect(RemoteNetworkInterface(address: "192.168.16.2", netmask: "0.0.0.0") == nil)
		for address in ["", "example.com", "1.2.3.999", "2001:::1", "::1", "ff02::1", "0.0.0.0", "127.0.0.1"] {
			#expect(NumericIPAddress(address)?.isUnicast != true)
		}
	}

	@Test func summarisesInBothLanguages() {
		defer { L10n.pin(language: nil) }
		for (language, direct, vpn) in [("zh-Hans", "P2P 直连（网络待确认）", "VPN 直连"), ("en", "Peer-to-peer (network undetermined)", "Direct over VPN")] {
			L10n.pin(language: language)
			#expect(RemoteStreamStats(route: .direct).summary == direct)
			#expect(RemoteStreamStats(route: .vpn).summary == vpn)
		}
		#expect(RemoteStreamStats().summary.isEmpty)
		#expect(RemoteStreamStats(jitterBufferMs: 30).pictureDelayMs == nil)
	}
}
