import Foundation

/// Persists the phone's identity and every paired desktop (port of
/// `pairing-store.ts`). Only one desktop is "current", but records for several
/// are kept so a later multi-computer UI needs no migration. Secrets (identity
/// and per-desktop credential) go to `secrets`; everything else to `settings`.
public final class PairingStore {
	static let identityKey = "vetta.identity.secret"
	static let desktopsKey = "vetta.desktops"
	static let currentKey = "vetta.desktops.current"
	static func secretKey(for desktopIdentityKey: String) -> String { "vetta.desktop.\(desktopIdentityKey).secret" }

	private let settings: KeyValueStore
	private let secrets: KeyValueStore
	private var identity: RemoteIdentityKeyPair?
	public private(set) var desktops: [StoredDesktop] = []
	private var current: String?

	public init(settings: KeyValueStore, secrets: KeyValueStore) {
		self.settings = settings
		self.secrets = secrets
	}

	public func load() {
		if let secret = secrets.get(Self.identityKey), let bytes = try? Base64URL.decode(secret), let pair = try? RemoteIdentityKeyPair(secretKey: bytes) {
			identity = pair
		} else {
			let pair = RemoteIdentityKeyPair.generate()
			identity = pair
			secrets.set(Self.identityKey, Base64URL.encode(pair.secretKey))
		}
		desktops = settings.get(Self.desktopsKey).map(Self.parseDesktops) ?? []
		current = settings.get(Self.currentKey) ?? desktops.first?.desktopIdentityKey
	}

	public func getIdentity() -> RemoteIdentityKeyPair {
		guard let identity else { preconditionFailure("pairing store is not loaded") }
		return identity
	}

	public func getCurrent() -> DesktopRecord? {
		guard let stored = desktops.first(where: { $0.desktopIdentityKey == current }),
		      let secret = secrets.get(Self.secretKey(for: stored.desktopIdentityKey))
		else { return nil }
		return stored.withSecret(secret)
	}

	public var hasCurrent: Bool { desktops.contains { $0.desktopIdentityKey == current } }

	public func save(_ record: DesktopRecord) {
		secrets.set(Self.secretKey(for: record.desktopIdentityKey), record.mobileSecret)
		desktops = [record.stored] + desktops.filter { $0.desktopIdentityKey != record.desktopIdentityKey }
		current = record.desktopIdentityKey
		persist()
	}

	public func update(_ desktopIdentityKey: String, _ patch: (inout StoredDesktop) -> Void) {
		guard let index = desktops.firstIndex(where: { $0.desktopIdentityKey == desktopIdentityKey }) else { return }
		patch(&desktops[index])
		persist()
	}

	public func revoke(_ desktopIdentityKey: String) {
		desktops.removeAll { $0.desktopIdentityKey == desktopIdentityKey }
		secrets.remove(Self.secretKey(for: desktopIdentityKey))
		if current == desktopIdentityKey { current = desktops.first?.desktopIdentityKey }
		persist()
	}

	private func persist() {
		if let data = try? JSONEncoder().encode(desktops), let text = String(data: data, encoding: .utf8) {
			settings.set(Self.desktopsKey, text)
		}
		if let current { settings.set(Self.currentKey, current) } else { settings.remove(Self.currentKey) }
	}

	static func parseDesktops(_ raw: String) -> [StoredDesktop] {
		guard let value = try? JSONValue.parse(raw), let list = value.arrayValue else { return [] }
		return list.compactMap { entry in
			guard let key = entry["desktopIdentityKey"]?.stringValue, let pairingId = entry["pairingId"]?.stringValue else { return nil }
			return StoredDesktop(
				desktopIdentityKey: key,
				desktopName: entry["desktopName"]?.stringValue ?? "Vetta Desktop",
				pairingId: pairingId,
				lanEndpoints: (entry["lanEndpoints"]?.arrayValue ?? []).compactMap(\.stringValue),
				relayBaseUrl: entry["relayBaseUrl"]?.stringValue,
				lastEventSequence: Int(entry["lastEventSequence"]?.numberValue ?? 0),
				pairedAt: entry["pairedAt"]?.numberValue ?? 0,
				lastSeenAt: entry["lastSeenAt"]?.numberValue ?? 0
			)
		}
	}
}
