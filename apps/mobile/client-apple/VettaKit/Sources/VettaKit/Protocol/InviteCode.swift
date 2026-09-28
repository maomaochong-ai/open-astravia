import CommonCrypto
import CryptoKit
import Foundation

/// Pairing with a connection code and password (port of `@vetta/remote-control`'s
/// `invite-code.ts`, ADR-0136): the desktop leaves its pairing link sealed under both on
/// the relay, in a mailbox named by a hash of the code; this phone fetches it and opens
/// it with the password. The two ends must agree byte for byte; a shared test vector
/// keeps them honest.
public enum InviteCode {
	public static let codeLength = 8
	public static let passwordLength = 6
	nonisolated static let kdfIterations = 200_000
	static let associatedData = "vetta-invite-v1"

	/// The relay a desktop uses unless it was set up with its own.
	public static let defaultRelayBaseUrl = "wss://relay.flowerwine.dpdns.org"

	/// Crockford base32: no I, L, O or U, so a code read aloud or retyped survives.
	private static let alphabet = Set("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
	private static let boxIdPrefix = "vetta-invite-box-v1:"
	nonisolated private static let keySaltPrefix = "vetta-invite-key-v1:"

	public struct Envelope: Equatable, Sendable {
		public var nonce: String
		public var ciphertext: String
	}

	/// What was typed, as the code it names: case, spaces and dashes do not matter, and
	/// the letters Crockford leaves out read as the digits they look like. Nil when it
	/// cannot be a code.
	public static func normalize(_ input: String) -> String? {
		let code = String(input.uppercased().compactMap { char -> Character? in
			if char.isWhitespace || char == "-" { return nil }
			switch char {
			case "O": return "0"
			case "I", "L": return "1"
			default: return char
			}
		})
		guard code.count == codeLength, code.allSatisfy(alphabet.contains) else { return nil }
		return code
	}

	/// What the code boxes show while a code is typed or pasted: the characters it can
	/// hold, read as `normalize` reads them, anything else dropped, at most eight.
	public static func typedCode(_ input: String) -> String {
		String(input.uppercased().compactMap { char -> Character? in
			switch char {
			case "O": "0"
			case "I", "L": "1"
			default: alphabet.contains(char) ? char : nil
			}
		}.prefix(codeLength))
	}

	/// The digits of what was typed or pasted into the password boxes, at most six.
	public static func typedPassword(_ input: String) -> String {
		String(input.filter { $0.isASCII && $0.isNumber }.prefix(passwordLength))
	}

	public static func isValidPassword(_ password: String) -> Bool {
		password.count == passwordLength && password.allSatisfy { $0.isASCII && $0.isNumber }
	}

	/// What a desktop's pairing QR code holds once its connection code is on the relay
	/// (ADR-0138): the code and password instead of the whole pairing link, so the code
	/// is sparse enough to scan at a glance. The relay is named only when it is not the
	/// default one.
	public struct QR: Equatable, Sendable {
		public var code: String
		public var password: String
		public var relayBaseUrl: String?
	}

	private static let qrPrefix = "VETTA://PAIR/"

	/// The code, password and relay in a scanned QR code; nil for anything else, such as
	/// a whole pairing link. Mirrors `parseInviteQr` in `@vetta/remote-control`.
	public static func parseQR(_ text: String) -> QR? {
		let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
		guard trimmed.uppercased().hasPrefix(qrPrefix) else { return nil }
		let parts = trimmed.dropFirst(qrPrefix.count).split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
		let path = parts[0].split(separator: "/", omittingEmptySubsequences: false)
		guard path.count == 2, let code = normalize(String(path[0])), isValidPassword(String(path[1])) else { return nil }
		var qr = QR(code: code, password: String(path[1]))
		if parts.count == 2 {
			for item in parts[1].split(separator: "&") where item.hasPrefix("relay=") {
				guard let relay = item.dropFirst("relay=".count).removingPercentEncoding,
				      relay.lowercased().hasPrefix("ws://") || relay.lowercased().hasPrefix("wss://"),
				      let normalized = PairingURI.normalizeRelayBaseUrl(relay)
				else { return nil }
				qr.relayBaseUrl = normalized
			}
		}
		return qr
	}

	/// The mailbox's name on the relay; the code itself never leaves the two ends.
	public static func boxId(_ code: String) -> String {
		Base64URL.encode(Data(SHA256.hash(data: Data("\(boxIdPrefix)\(code)".utf8))))
	}

	public static func boxUrl(relayBaseUrl: String, code: String) -> String {
		var base = relayBaseUrl
		while base.hasSuffix("/") { base.removeLast() }
		if base.hasPrefix("wss:") { base = "https:" + base.dropFirst(4) } else if base.hasPrefix("ws:") { base = "http:" + base.dropFirst(3) }
		return "\(base)/v2/invite/\(boxId(code))"
	}

	/// The relay a typed address names; a bare host is taken to mean its secure
	/// WebSocket address. Nothing typed, or nothing usable, means the default relay.
	public static func relayBaseUrl(typed: String?) -> String {
		let trimmed = typed?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		guard !trimmed.isEmpty else { return defaultRelayBaseUrl }
		return PairingURI.normalizeRelayBaseUrl(trimmed)
			?? PairingURI.normalizeRelayBaseUrl("wss://\(trimmed)")
			?? defaultRelayBaseUrl
	}

	/// The pairing link inside; throws when the password (or code) is wrong. The key is
	/// stretched on purpose (200 000 rounds), so it is derived off the main actor.
	public static func open(_ envelope: Envelope, code: String, password: String) async throws -> String {
		let key = await Task.detached { key(code: code, password: password) }.value
		let plaintext: Data
		do {
			plaintext = try RemoteCrypto.xchachaOpen(
				key: key,
				nonce: Base64URL.decode(envelope.nonce),
				ciphertext: Base64URL.decode(envelope.ciphertext),
				associatedData: Data(associatedData.utf8)
			)
		} catch {
			throw RemoteProtocolError("invite failed authentication")
		}
		guard let uri = String(data: plaintext, encoding: .utf8) else { throw RemoteProtocolError("invite is not text") }
		return uri
	}

	/// What the desktop does; here for tests.
	static func seal(_ uri: String, code: String, password: String, nonce: Data) throws -> Envelope {
		let ciphertext = try RemoteCrypto.xchachaSeal(
			key: key(code: code, password: password),
			nonce: nonce,
			plaintext: Data(uri.utf8),
			associatedData: Data(associatedData.utf8)
		)
		return Envelope(nonce: Base64URL.encode(nonce), ciphertext: Base64URL.encode(ciphertext))
	}

	/// `PBKDF2-HMAC-SHA256(password, "vetta-invite-key-v1:" + code, 200 000, 32 bytes)`.
	nonisolated private static func key(code: String, password: String) -> Data {
		let passwordBytes = Array(password.utf8)
		let salt = Array("\(keySaltPrefix)\(code)".utf8)
		var derived = [UInt8](repeating: 0, count: 32)
		let status = passwordBytes.withUnsafeBufferPointer { passwordBuffer in
			passwordBuffer.withMemoryRebound(to: Int8.self) { passwordChars in
				CCKeyDerivationPBKDF(
					CCPBKDFAlgorithm(kCCPBKDF2),
					passwordChars.baseAddress, passwordBytes.count,
					salt, salt.count,
					CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
					UInt32(kdfIterations),
					&derived, derived.count
				)
			}
		}
		precondition(status == kCCSuccess, "PBKDF2 failed")
		return Data(derived)
	}
}
