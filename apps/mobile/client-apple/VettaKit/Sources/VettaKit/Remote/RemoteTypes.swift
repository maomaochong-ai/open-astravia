import Foundation

/// One paired desktop as the phone knows it. The secret lives in the keychain.
public struct DesktopRecord: Equatable, Sendable {
	/// base64url X25519 identity key of the desktop; primary key.
	public var desktopIdentityKey: String
	public var desktopName: String
	public var pairingId: String
	public var mobileSecret: String
	public var lanEndpoints: [String]
	public var relayBaseUrl: String?
	public var lastEventSequence: Int
	public var pairedAt: Double
	public var lastSeenAt: Double

	public init(desktopIdentityKey: String, desktopName: String, pairingId: String, mobileSecret: String, lanEndpoints: [String], relayBaseUrl: String? = nil, lastEventSequence: Int = 0, pairedAt: Double = 0, lastSeenAt: Double = 0) {
		self.desktopIdentityKey = desktopIdentityKey
		self.desktopName = desktopName
		self.pairingId = pairingId
		self.mobileSecret = mobileSecret
		self.lanEndpoints = lanEndpoints
		self.relayBaseUrl = relayBaseUrl
		self.lastEventSequence = lastEventSequence
		self.pairedAt = pairedAt
		self.lastSeenAt = lastSeenAt
	}

	public var stored: StoredDesktop {
		StoredDesktop(desktopIdentityKey: desktopIdentityKey, desktopName: desktopName, pairingId: pairingId, lanEndpoints: lanEndpoints, relayBaseUrl: relayBaseUrl, lastEventSequence: lastEventSequence, pairedAt: pairedAt, lastSeenAt: lastSeenAt)
	}
}

/// A desktop record without its secret: what is persisted in plain settings and shown in the UI.
public struct StoredDesktop: Equatable, Codable, Sendable {
	public var desktopIdentityKey: String
	public var desktopName: String
	public var pairingId: String
	public var lanEndpoints: [String]
	public var relayBaseUrl: String?
	public var lastEventSequence: Int
	public var pairedAt: Double
	public var lastSeenAt: Double

	func withSecret(_ secret: String) -> DesktopRecord {
		DesktopRecord(desktopIdentityKey: desktopIdentityKey, desktopName: desktopName, pairingId: pairingId, mobileSecret: secret, lanEndpoints: lanEndpoints, relayBaseUrl: relayBaseUrl, lastEventSequence: lastEventSequence, pairedAt: pairedAt, lastSeenAt: lastSeenAt)
	}
}

public enum LinkStatus: String, Sendable {
	case offline, connecting, online
}

public enum LinkChannel: String, Sendable {
	case lan, relay
}

public struct LinkSnapshot: Equatable, Sendable {
	public var status: LinkStatus
	public var channel: LinkChannel?
	public var rttMs: Double?
	/// False when the transport is up but the relay reports the desktop absent.
	public var peerOnline: Bool
	public var desktop: RemoteDeviceStatus?
	public var lastError: String?
	public var reconnectAttempt: Int

	public static let offline = LinkSnapshot(status: .offline, channel: nil, peerOnline: false, reconnectAttempt: 0)

	public var isUsable: Bool { status == .online && peerOnline }
}

public struct TransportOptions: Sendable {
	public var pairingSecret: String?
	public var manual: Bool
	public var keepaliveIntervalMs: Double?

	public init(pairingSecret: String? = nil, manual: Bool = false, keepaliveIntervalMs: Double? = nil) {
		self.pairingSecret = pairingSecret
		self.manual = manual
		self.keepaliveIntervalMs = keepaliveIntervalMs
	}
}

public typealias TransportFactory = (String, TransportOptions) -> RemoteTransport

public struct LinkIdentity: Sendable {
	public var identity: RemoteIdentityKeyPair
	public var deviceId: String
	public var deviceName: String

	public init(identity: RemoteIdentityKeyPair, deviceId: String, deviceName: String) {
		self.identity = identity
		self.deviceId = deviceId
		self.deviceName = deviceName
	}
}

public protocol KeyValueStore: AnyObject {
	func get(_ key: String) -> String?
	func set(_ key: String, _ value: String)
	func remove(_ key: String)
}

public final class MemoryKeyValueStore: KeyValueStore {
	private var values: [String: String] = [:]
	public init() {}
	public func get(_ key: String) -> String? { values[key] }
	public func set(_ key: String, _ value: String) { values[key] = value }
	public func remove(_ key: String) { values[key] = nil }
}

/// Non-secret settings.
public final class UserDefaultsStore: KeyValueStore {
	private let defaults: UserDefaults
	public init(defaults: UserDefaults = .standard) { self.defaults = defaults }
	public func get(_ key: String) -> String? { defaults.string(forKey: key) }
	public func set(_ key: String, _ value: String) { defaults.set(value, forKey: key) }
	public func remove(_ key: String) { defaults.removeObject(forKey: key) }
}

public struct LinkOfflineError: Error, LocalizedError {
	public init() {}
	public var errorDescription: String? { "desktop is offline" }
}
