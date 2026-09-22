import CryptoKit
import Foundation
import Security

/// End-to-end encryption for protocol v2, byte-compatible with `crypto.ts`:
/// X25519 identity + ephemeral keys, HKDF-SHA256 and XChaCha20-Poly1305.
/// CryptoKit supplies X25519, HKDF and the IETF ChaCha20-Poly1305 AEAD; the
/// extended 24-byte nonce is the standard HChaCha20 subkey construction.
public struct RemoteIdentityKeyPair: Sendable {
	public let secretKey: Data
	public let publicKey: Data

	public init(secretKey: Data) throws {
		guard secretKey.count == 32 else { throw RemoteProtocolError("identity secret must be 32 bytes") }
		let privateKey = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: secretKey)
		self.secretKey = secretKey
		publicKey = privateKey.publicKey.rawRepresentation
	}

	public static func generate(randomBytes: RandomBytes = RemoteCrypto.randomBytes) -> RemoteIdentityKeyPair {
		// A 32-byte random scalar is always a valid X25519 secret (clamping happens inside).
		try! RemoteIdentityKeyPair(secretKey: randomBytes(32))
	}
}

public typealias RandomBytes = (Int) -> Data

public struct RemoteSessionKeys: Sendable {
	public let sendKey: Data
	public let receiveKey: Data
}

public enum RemoteCrypto {
	static let nonceLength = 24
	static let keyLength = 32
	static let infoPrefix = "vetta-remote-v2"
	public static let sealedAssociatedData = "vetta-remote-v\(remoteProtocolVersion)"

	nonisolated public static func randomBytes(_ count: Int) -> Data {
		var bytes = [UInt8](repeating: 0, count: count)
		let status = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
		precondition(status == errSecSuccess, "system random generator failed")
		return Data(bytes)
	}

	static func sharedSecret(_ secretKey: Data, _ peerPublicKey: Data) throws -> Data {
		let privateKey = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: secretKey)
		let peer = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: peerPublicKey)
		let shared = try privateKey.sharedSecretFromKeyAgreement(with: peer)
		return shared.withUnsafeBytes { Data($0) }
	}

	static func hkdf(_ ikm: Data, salt: Data, info: String, length: Int) -> Data {
		let key = HKDF<SHA256>.deriveKey(
			inputKeyMaterial: SymmetricKey(data: ikm),
			salt: salt,
			info: Data(info.utf8),
			outputByteCount: length
		)
		return key.withUnsafeBytes { Data($0) }
	}

	public static func deriveSessionKeys(
		role: RemoteRole,
		identity: RemoteIdentityKeyPair,
		ephemeral: RemoteIdentityKeyPair,
		peerIdentityKey: Data,
		peerEphemeralKey: Data
	) throws -> RemoteSessionKeys {
		let ephemeralShared = try sharedSecret(ephemeral.secretKey, peerEphemeralKey)
		let staticToPeerEphemeral = try sharedSecret(identity.secretKey, peerEphemeralKey)
		let ephemeralToPeerStatic = try sharedSecret(ephemeral.secretKey, peerIdentityKey)
		// Order the static/ephemeral mixes by role so both sides compute the same input.
		let mobileFirst = role == .mobile
		let ikm = ephemeralShared
			+ (mobileFirst ? staticToPeerEphemeral : ephemeralToPeerStatic)
			+ (mobileFirst ? ephemeralToPeerStatic : staticToPeerEphemeral)
		let salt = mobileFirst
			? identity.publicKey + peerIdentityKey + ephemeral.publicKey + peerEphemeralKey
			: peerIdentityKey + identity.publicKey + peerEphemeralKey + ephemeral.publicKey
		let material = hkdf(ikm, salt: salt, info: "\(infoPrefix)/session", length: keyLength * 2)
		let mobileToDesktop = material.prefix(keyLength)
		let desktopToMobile = material.suffix(keyLength)
		return mobileFirst
			? RemoteSessionKeys(sendKey: Data(mobileToDesktop), receiveKey: Data(desktopToMobile))
			: RemoteSessionKeys(sendKey: Data(desktopToMobile), receiveKey: Data(mobileToDesktop))
	}

	// MARK: XChaCha20-Poly1305

	public static func xchachaSeal(key: Data, nonce: Data, plaintext: Data, associatedData: Data) throws -> Data {
		let (subkey, ietfNonce) = try extendedNonce(key: key, nonce: nonce)
		let box = try ChaChaPoly.seal(plaintext, using: SymmetricKey(data: subkey), nonce: ietfNonce, authenticating: associatedData)
		return box.ciphertext + box.tag
	}

	public static func xchachaOpen(key: Data, nonce: Data, ciphertext: Data, associatedData: Data) throws -> Data {
		guard ciphertext.count >= 16 else { throw RemoteProtocolError("ciphertext too short") }
		let (subkey, ietfNonce) = try extendedNonce(key: key, nonce: nonce)
		let box = try ChaChaPoly.SealedBox(
			nonce: ietfNonce,
			ciphertext: ciphertext.prefix(ciphertext.count - 16),
			tag: ciphertext.suffix(16)
		)
		return try ChaChaPoly.open(box, using: SymmetricKey(data: subkey), authenticating: associatedData)
	}

	private static func extendedNonce(key: Data, nonce: Data) throws -> (Data, ChaChaPoly.Nonce) {
		guard key.count == 32, nonce.count == nonceLength else { throw RemoteProtocolError("invalid key or nonce length") }
		let subkey = hchacha20(key: [UInt8](key), nonce: [UInt8](nonce.prefix(16)))
		let ietf = try ChaChaPoly.Nonce(data: Data([0, 0, 0, 0]) + nonce.suffix(8))
		return (Data(subkey), ietf)
	}

	static func hchacha20(key: [UInt8], nonce: [UInt8]) -> [UInt8] {
		func word(_ bytes: [UInt8], _ offset: Int) -> UInt32 {
			UInt32(bytes[offset]) | UInt32(bytes[offset + 1]) << 8 | UInt32(bytes[offset + 2]) << 16 | UInt32(bytes[offset + 3]) << 24
		}
		var state: [UInt32] = [0x6170_7865, 0x3320_646E, 0x7962_2D32, 0x6B20_6574]
		for index in 0 ..< 8 { state.append(word(key, index * 4)) }
		for index in 0 ..< 4 { state.append(word(nonce, index * 4)) }
		func quarter(_ a: Int, _ b: Int, _ c: Int, _ d: Int) {
			state[a] &+= state[b]; state[d] ^= state[a]; state[d] = state[d].rotateLeft(16)
			state[c] &+= state[d]; state[b] ^= state[c]; state[b] = state[b].rotateLeft(12)
			state[a] &+= state[b]; state[d] ^= state[a]; state[d] = state[d].rotateLeft(8)
			state[c] &+= state[d]; state[b] ^= state[c]; state[b] = state[b].rotateLeft(7)
		}
		for _ in 0 ..< 10 {
			quarter(0, 4, 8, 12); quarter(1, 5, 9, 13); quarter(2, 6, 10, 14); quarter(3, 7, 11, 15)
			quarter(0, 5, 10, 15); quarter(1, 6, 11, 12); quarter(2, 7, 8, 13); quarter(3, 4, 9, 14)
		}
		var output: [UInt8] = []
		for index in [0, 1, 2, 3, 12, 13, 14, 15] {
			let value = state[index]
			output += [UInt8(value & 0xFF), UInt8(value >> 8 & 0xFF), UInt8(value >> 16 & 0xFF), UInt8(value >> 24 & 0xFF)]
		}
		return output
	}

	// MARK: Sealed frames

	public static func sealFrame(key: Data, frame: RemoteFrame, associatedData: String = sealedAssociatedData, randomBytes: RandomBytes = RemoteCrypto.randomBytes) throws -> RemoteSealed {
		let nonce = randomBytes(nonceLength)
		let ciphertext = try xchachaSeal(
			key: key,
			nonce: nonce,
			plaintext: Data(frame.json.serialized().utf8),
			associatedData: Data(associatedData.utf8)
		)
		return RemoteSealed(nonce: Base64URL.encode(nonce), ciphertext: Base64URL.encode(ciphertext))
	}

	public static func openFrame(key: Data, sealed: RemoteSealed, associatedData: String = sealedAssociatedData) throws -> RemoteFrame {
		let plaintext: Data
		do {
			plaintext = try xchachaOpen(
				key: key,
				nonce: try Base64URL.decode(sealed.nonce),
				ciphertext: try Base64URL.decode(sealed.ciphertext),
				associatedData: Data(associatedData.utf8)
			)
		} catch {
			throw RemoteProtocolError("sealed frame failed authentication")
		}
		let value: JSONValue
		do {
			value = try JSONValue.parse(plaintext)
		} catch {
			throw RemoteProtocolError("sealed frame is not valid JSON")
		}
		return try RemoteFrame.decodeSession(value)
	}

	/// Six digits both ends display during a manual pairing; derived from both identity keys.
	public static func verificationCode(_ identityKeyA: Data, _ identityKeyB: Data) -> String {
		let ordered = compare(identityKeyA, identityKeyB) <= 0 ? identityKeyA + identityKeyB : identityKeyB + identityKeyA
		let digest = [UInt8](hkdf(ordered, salt: Data(), info: "\(infoPrefix)/sas", length: 4))
		let value = UInt32(digest[0]) << 24 | UInt32(digest[1]) << 16 | UInt32(digest[2]) << 8 | UInt32(digest[3])
		let code = String(value % 1_000_000)
		return String(repeating: "0", count: max(0, 6 - code.count)) + code
	}

	public static func sha256Hex(_ text: String) -> String {
		SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
	}

	public static func randomToken(bytes: Int = 32, randomBytes: RandomBytes = RemoteCrypto.randomBytes) -> String {
		Base64URL.encode(randomBytes(bytes))
	}

	public static func decodePublicKey(_ text: String, field: String = "public key") throws -> Data {
		let bytes = try Base64URL.decode(text)
		guard bytes.count == keyLength else { throw RemoteProtocolError("\(field) must be 32 bytes") }
		return bytes
	}

	/// Constant-time comparison.
	public static func bytesEqual(_ a: Data, _ b: Data) -> Bool {
		guard a.count == b.count else { return false }
		var diff: UInt8 = 0
		for (left, right) in zip(a, b) { diff |= left ^ right }
		return diff == 0
	}

	private static func compare(_ a: Data, _ b: Data) -> Int {
		for (left, right) in zip(a, b) where left != right { return Int(left) - Int(right) }
		return a.count - b.count
	}
}

extension UInt32 {
	fileprivate func rotateLeft(_ count: UInt32) -> UInt32 { (self << count) | (self >> (32 - count)) }
}

public enum Base64URL {
	public static func encode(_ data: Data) -> String {
		data.base64EncodedString()
			.replacingOccurrences(of: "+", with: "-")
			.replacingOccurrences(of: "/", with: "_")
			.replacingOccurrences(of: "=", with: "")
	}

	public static func decode(_ text: String) throws -> Data {
		var normalized = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
		normalized += String(repeating: "=", count: (4 - normalized.count % 4) % 4)
		guard let data = Data(base64Encoded: normalized) else { throw RemoteProtocolError("value is not valid base64url") }
		return data
	}
}
