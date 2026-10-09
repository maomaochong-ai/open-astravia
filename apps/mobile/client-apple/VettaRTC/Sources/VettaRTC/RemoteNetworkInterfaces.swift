import Darwin
import Foundation
import VettaKit

/// Capture interface addresses and real masks, not the system's default internet
/// path: WebRTC may have selected another interface. No addresses leave this sample.
enum RemoteNetworkInterfaces {
	static func snapshot() -> [RemoteNetworkInterface] {
		var first: UnsafeMutablePointer<ifaddrs>?
		guard getifaddrs(&first) == 0, let first else { return [] }
		defer { freeifaddrs(first) }
		var result: [RemoteNetworkInterface] = []
		var cursor: UnsafeMutablePointer<ifaddrs>? = first
		while let current = cursor {
			defer { cursor = current.pointee.ifa_next }
			let item = current.pointee
			guard item.ifa_flags & UInt32(IFF_UP) != 0, item.ifa_flags & UInt32(IFF_LOOPBACK) == 0,
				let address = numeric(item.ifa_addr), let mask = numeric(item.ifa_netmask) else { continue }
			let name = String(cString: item.ifa_name)
			if let entry = RemoteNetworkInterface(address: address, netmask: mask,
				isTunnel: name.hasPrefix("utun") || name.hasPrefix("ipsec")) {
				result.append(entry)
			}
		}
		return result
	}

	private static func numeric(_ address: UnsafeMutablePointer<sockaddr>?) -> String? {
		guard let address, address.pointee.sa_family == AF_INET || address.pointee.sa_family == AF_INET6 else { return nil }
		var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
		guard getnameinfo(address, socklen_t(address.pointee.sa_len), &buffer, socklen_t(buffer.count), nil, 0, NI_NUMERICHOST) == 0 else { return nil }
		return String(decoding: buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)
	}
}
