import Foundation
import Security
import VettaKit

/// Secrets (the phone's identity and each desktop's credential) live in the
/// keychain, readable after first unlock and never migrated to another device.
final class KeychainStore: KeyValueStore {
	private let service: String

	init(service: String = "com.openvetta.mobile") {
		self.service = service
	}

	func get(_ key: String) -> String? {
		var query = baseQuery(key)
		query[kSecReturnData as String] = true
		query[kSecMatchLimit as String] = kSecMatchLimitOne
		var result: AnyObject?
		guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
		return String(data: data, encoding: .utf8)
	}

	func set(_ key: String, _ value: String) {
		let data = Data(value.utf8)
		let update: [String: Any] = [
			kSecValueData as String: data,
			kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
		]
		let status = SecItemUpdate(baseQuery(key) as CFDictionary, update as CFDictionary)
		if status == errSecItemNotFound {
			var insert = baseQuery(key)
			insert.merge(update) { _, new in new }
			SecItemAdd(insert as CFDictionary, nil)
		}
	}

	func remove(_ key: String) {
		SecItemDelete(baseQuery(key) as CFDictionary)
	}

	private func baseQuery(_ key: String) -> [String: Any] {
		[
			kSecClass as String: kSecClassGenericPassword,
			kSecAttrService as String: service,
			kSecAttrAccount as String: key,
		]
	}
}
