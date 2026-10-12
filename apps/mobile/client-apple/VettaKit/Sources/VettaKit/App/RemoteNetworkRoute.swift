import Foundation
import Network

/// Evidence about a local interface, sampled alongside WebRTC statistics. Addresses
/// stay in memory: they must never be included in diagnostics or persisted.
public struct RemoteNetworkInterface: Equatable, Sendable {
	public var address: String
	public var prefixLength: Int
	public var isTunnel: Bool

	public init(address: String, prefixLength: Int, isTunnel: Bool = false) {
		self.address = address
		self.prefixLength = prefixLength
		self.isTunnel = isTunnel
	}
	public init?(address: String, netmask: String, isTunnel: Bool = false) {
		guard let ip = NumericIPAddress(address), let mask = NumericIPAddress(netmask), ip.bytes.count == mask.bytes.count else { return nil }
		var prefix = 0
		var sawZero = false
		for byte in mask.bytes {
			for bit in (0..<8).reversed() {
				if byte & (1 << bit) == 0 { sawZero = true }
				else if sawZero { return nil }
				else { prefix += 1 }
			}
		}
		guard prefix > 0 else { return nil }
		self.init(address: address, prefixLength: prefix, isTunnel: isTunnel)
	}
}

extension RemoteStreamStats {
	static func route(local: Entry?, remote: Entry?, interfaces: [RemoteNetworkInterface]) -> Route? {
		let localType = local?.text("candidateType")
		let remoteType = remote?.text("candidateType")
		if localType == "relay" || remoteType == "relay" { return .relayed }
		let directTypes: Set<String> = ["host", "srflx", "prflx"]
		guard let local, let remote, let localType, let remoteType,
			directTypes.contains(localType), directTypes.contains(remoteType) else { return nil }
		let network = [local.text("networkType"), local.text("networkAdapterType")].compactMap { $0 }
		if local.values["vpn"]?.boolValue == true || network.contains("vpn") { return .vpn }
		let localAddress = NumericIPAddress(local.text("address") ?? local.text("ip"))
		let base = localType == "host" ? localAddress : NumericIPAddress(local.text("relatedAddress"))
		let matches = interfaces.filter { base != nil && NumericIPAddress($0.address) == base }
		if matches.count == 1, matches[0].isTunnel { return .vpn }
		if network.contains(where: { $0 == "cellular" || ["cellular2g", "cellular3g", "cellular4g", "cellular5g"].contains($0) }) {
			return .internet
		}
		// A host candidate may be a public IPv6 address. Only the selected physical
		// interface's actual prefix proves an on-link LAN; a private IP alone does not.
		guard network.contains("wifi") || network.contains("ethernet"), matches.count == 1,
			let base, let destination = NumericIPAddress(remote.text("address") ?? remote.text("ip")) else { return .direct }
		// A shared mapped address can mean NAT hairpinning or carrier NAT, not a LAN.
		if localType != "host", destination == localAddress { return .direct }
		let prefix = matches[0].prefixLength
		guard prefix > 0, prefix <= base.bytes.count * 8 else { return .direct }
		if destination.isUnicast && base.contains(destination, prefixLength: prefix) { return .lan }
		if destination.isGlobal { return .internet }
		// Private addresses outside this prefix may be a routed LAN or a tunnel.
		return .direct
	}
}

/// Literal addresses only; Network's parsers do not perform DNS resolution.
struct NumericIPAddress: Equatable {
	let bytes: [UInt8]

	init?(_ text: String?) {
		guard let text, !text.isEmpty else { return nil }
		let literal = String(text.split(separator: "%", maxSplits: 1, omittingEmptySubsequences: false)[0])
		if let ipv4 = IPv4Address(literal) {
			bytes = Array(ipv4.rawValue)
		} else if let ipv6 = IPv6Address(literal) {
			let raw = Array(ipv6.rawValue)
			bytes = raw.prefix(10).allSatisfy { $0 == 0 } && raw[10] == 255 && raw[11] == 255 ? Array(raw.suffix(4)) : raw
		} else { return nil }
	}

	func contains(_ other: Self, prefixLength: Int) -> Bool {
		guard bytes.count == other.bytes.count, prefixLength > 0, prefixLength <= bytes.count * 8 else { return false }
		for bit in 0..<prefixLength {
			let mask = UInt8(1 << (7 - bit % 8))
			if bytes[bit / 8] & mask != other.bytes[bit / 8] & mask { return false }
		}
		return true
	}

	var isUnicast: Bool {
		if bytes.count == 4 { return bytes[0] != 0 && bytes[0] != 127 && bytes[0] < 224 }
		return !bytes.allSatisfy { $0 == 0 } && bytes != Array(repeating: 0, count: 15) + [1] && bytes[0] != 255
	}

	var isGlobal: Bool {
		guard isUnicast else { return false }
		if bytes.count == 16 { return bytes[0] & 0xe0 == 0x20 }
		return !(bytes[0] == 10 || (bytes[0] == 172 && (16...31).contains(bytes[1])) ||
			(bytes[0] == 192 && bytes[1] == 168) || (bytes[0] == 169 && bytes[1] == 254) ||
			(bytes[0] == 100 && (64...127).contains(bytes[1])) || (bytes[0] == 198 && (18...19).contains(bytes[1])))
	}
}
