import Foundation
import Testing
@testable import VettaKit

/// Vectors produced by the TypeScript `@vetta/remote-control` package (noble
/// primitives) so the Swift port is proven byte-compatible with the desktop.
/// Regenerate with `bun apps/mobile/client-apple/scripts/crypto-vectors.ts`.
enum Vectors {
	static let mobileIdentitySecret = "HyYtNDtCSVBXXmVsc3qBiI-WnaSrsrnAx87V3OPq8fg"
	static let mobileIdentityPublic = "5XxpXrLGE8G-VOthU0PoK2qVT4hAmqOtH6c50AQfGiY"
	static let mobileEphemeralSecret = "PkVMU1phaG92fYSLkpmgp661vMPK0djf5u30-wIJEBc"
	static let desktopIdentitySecret = "XWRrcnmAh46VnKOqsbi_xs3U2-Lp8Pf-BQwTGiEoLzY"
	static let desktopIdentityPublic = "V-U_7B2yLhcIrcj6dteUYQTZpeC-YvqqG-h-d--vWyI"
	static let desktopEphemeralSecret = "fIOKkZifpq20u8LJ0Nfe5ezz-gEIDxYdJCsyOUBHTlU"
	static let mobileSend = "FlqK4Ma7JMspbHxbahkRqv1gaHD6ht4cHEk46qjdI4w"
	static let mobileReceive = "ZVa6cVHRj3-7Nrhc7_sxUHnW6LYxx7JzejWaT_P4tFY"
	static let sealedNonce = "ZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp7"
	static let sealedCiphertext = "OLWYn41kNHag8Ra9OiXptS39Y94ycZZ-lePe669kR4P6qgYv0lvvcEuI-FeV257_R2i-0ZXj2vISjJzRKjgnZcxw3IQxTL4Y-nFAlC1QamGizQoxS1aKqpd2DTYk_ZoTZK8RU8XdhpT8FJ8YTWifWDbPi1ka9VKcMtVqaHHqE2cycgWsiOHl0lmC4xkx3gIHZhH6GAroYcdWJNQg9kvhwyoS"
	static let code = "362234"
	static let sha = "7609e696580e3b7b6bc52c2c60df9e03f2419358ddf17e60e1013177129b6620"

	static func pair(_ secret: String) throws -> RemoteIdentityKeyPair {
		try RemoteIdentityKeyPair(secretKey: Base64URL.decode(secret))
	}
}

@Suite struct CryptoCompatibilityTests {
	@Test func derivesTheSamePublicKeysAndSessionKeysAsTheDesktop() throws {
		let mobile = try Vectors.pair(Vectors.mobileIdentitySecret)
		let mobileEphemeral = try Vectors.pair(Vectors.mobileEphemeralSecret)
		let desktop = try Vectors.pair(Vectors.desktopIdentitySecret)
		let desktopEphemeral = try Vectors.pair(Vectors.desktopEphemeralSecret)
		#expect(Base64URL.encode(mobile.publicKey) == Vectors.mobileIdentityPublic)
		#expect(Base64URL.encode(desktop.publicKey) == Vectors.desktopIdentityPublic)
		let keys = try RemoteCrypto.deriveSessionKeys(role: .mobile, identity: mobile, ephemeral: mobileEphemeral, peerIdentityKey: desktop.publicKey, peerEphemeralKey: desktopEphemeral.publicKey)
		#expect(Base64URL.encode(keys.sendKey) == Vectors.mobileSend)
		#expect(Base64URL.encode(keys.receiveKey) == Vectors.mobileReceive)
		let desktopKeys = try RemoteCrypto.deriveSessionKeys(role: .desktop, identity: desktop, ephemeral: desktopEphemeral, peerIdentityKey: mobile.publicKey, peerEphemeralKey: mobileEphemeral.publicKey)
		#expect(desktopKeys.sendKey == keys.receiveKey)
		#expect(desktopKeys.receiveKey == keys.sendKey)
	}

	@Test func opensAFrameSealedByTheDesktopAndSealsIdentically() throws {
		let key = try Base64URL.decode(Vectors.mobileReceive)
		let frame = try RemoteCrypto.openFrame(key: key, sealed: RemoteSealed(nonce: Vectors.sealedNonce, ciphertext: Vectors.sealedCiphertext))
		guard case let .event(event) = frame else { Issue.record("expected event"); return }
		#expect(event.sequence == 1)
		#expect(event.name == .sessionMessage)
		#expect(event.payload?["text"]?.stringValue == "你好 world")
		let nonce = try Base64URL.decode(Vectors.sealedNonce)
		let resealed = try RemoteCrypto.sealFrame(key: key, frame: frame, randomBytes: { _ in nonce })
		// Key order differs from JSON.stringify, so compare by reopening instead of bytes.
		#expect(try RemoteCrypto.openFrame(key: key, sealed: resealed) == frame)
	}

	@Test func rejectsTamperedCiphertextAndWrongAssociatedData() throws {
		let key = try Base64URL.decode(Vectors.mobileReceive)
		var tampered = Array(Vectors.sealedCiphertext)
		tampered[10] = tampered[10] == "A" ? "B" : "A"
		#expect(throws: RemoteProtocolError.self) {
			try RemoteCrypto.openFrame(key: key, sealed: RemoteSealed(nonce: Vectors.sealedNonce, ciphertext: String(tampered)))
		}
		#expect(throws: RemoteProtocolError.self) {
			try RemoteCrypto.openFrame(key: key, sealed: RemoteSealed(nonce: Vectors.sealedNonce, ciphertext: Vectors.sealedCiphertext), associatedData: "other")
		}
	}

	@Test func matchesVerificationCodeAndHashes() throws {
		let mobile = try Base64URL.decode(Vectors.mobileIdentityPublic)
		let desktop = try Base64URL.decode(Vectors.desktopIdentityPublic)
		#expect(RemoteCrypto.verificationCode(mobile, desktop) == Vectors.code)
		#expect(RemoteCrypto.verificationCode(desktop, mobile) == Vectors.code)
		#expect(RemoteCrypto.sha256Hex("secret-1234567890abcdef") == Vectors.sha)
	}

	@Test func hchachaMatchesTheDraftTestVector() {
		// draft-irtf-cfrg-xchacha-03 §2.2.1
		let key = (0 ..< 32).map { UInt8($0) }
		let nonce: [UInt8] = [0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00, 0x4A, 0x00, 0x00, 0x00, 0x00, 0x31, 0x41, 0x59, 0x27]
		let expected = "82413b4227b27bfed30e42508a877d73a0f9e4d58a74a853c12ec41326d3ecdc"
		#expect(RemoteCrypto.hchacha20(key: key, nonce: nonce).map { String(format: "%02x", $0) }.joined() == expected)
	}
}

@Suite struct FrameDecodingTests {
	@Test func roundTripsEveryFrameType() throws {
		let key = "5XxpXrLGE8G-VOthU0PoK2qVT4hAmqOtH6c50AQfGiY"
		let frames: [RemoteFrame] = [
			.hello(RemoteHello(role: .mobile, deviceId: "d", deviceName: "n", capabilities: RemoteCapabilities(chat: true, sessionRead: true), connectionId: "c", identityKey: key, ephemeralKey: key)),
			.helloAck(RemoteHelloAck(connectionId: "c", peerDeviceId: "p", peerIdentityKey: key, peerEphemeralKey: key)),
			.pairingPending(RemotePairingPending(connectionId: "c", peerDeviceId: "p", peerIdentityKey: key)),
			.peerStatus(online: false),
			.sealed(RemoteSealed(nonce: Vectors.sealedNonce, ciphertext: "abc_-")),
			.request(RemoteRequest(requestId: "r", method: .sessionPrompt, sessionId: "s", payload: ["text": "hi"])),
			.response(RemoteResponse(requestId: "r", success: false, payload: nil, error: RemoteError(code: .busy, message: "m", retryable: true))),
			.event(RemoteEvent(eventId: "e", sequence: 3, name: .sessionState, sessionId: "s", payload: ["status": "running"])),
			.ack(sequence: 2),
			.resume(lastEventSequence: 0),
		]
		for frame in frames {
			#expect(try RemoteFrame.parse(line: frame.encodedLine().trimmingCharacters(in: .newlines)) == frame)
		}
	}

	@Test func rejectsInvalidFrames() {
		let invalid = [
			"not json",
			#"{"type":"hello","protocolVersion":1,"role":"mobile"}"#,
			#"{"type":"event","eventId":"e","sequence":0,"name":"session.state"}"#,
			#"{"type":"event","eventId":"e","sequence":1.5,"name":"session.state"}"#,
			#"{"type":"event","eventId":"e","sequence":1,"name":"nope"}"#,
			#"{"type":"response","requestId":"r","success":true,"error":{"code":"busy","message":"m","retryable":true}}"#,
			#"{"type":"response","requestId":"r","success":false}"#,
			#"{"type":"sealed","nonce":"short","ciphertext":"x"}"#,
			#"{"type":"request","requestId":"r","method":"session.prompt","sessionId":""}"#,
			#"{"type":"mystery"}"#,
		]
		for line in invalid {
			#expect(throws: RemoteProtocolError.self) { try RemoteFrame.parse(line: line) }
		}
		#expect(throws: RemoteProtocolError.self) { try RemoteFrame.decodeSession(.object(["type": "peer_status", "online": true])) }
	}

	@Test func speaksTheUploadModelAndSessionMethodsLikeTheDesktop() throws {
		for method in ["session.upload", "model.list", "session.configure", "session.rename", "session.pin", "session.delete"] {
			let frame = try RemoteFrame.parse(line: #"{"type":"request","requestId":"r","method":"\#(method)","sessionId":"s"}"#)
			if case let .request(request) = frame { #expect(request.method.rawValue == method) } else { Issue.record("\(method) should parse") }
		}
	}

	@Test func readsThePinTimeOnlyWhenItIsANumber() throws {
		let sessions = RemoteAPI.readSessionSummaries(try JSONValue.parse(#"""
		{"sessions":[{"id":"a","projectCwd":"/p","pinnedAt":42},{"id":"b","projectCwd":"/p","pinnedAt":"yesterday"}]}
		"""#))
		#expect(sessions.map(\.pinnedAt) == [42, nil])
		#expect(sessions.map(\.pinned) == [true, false])
	}

	@Test func readsModelOptionsAndTheSessionsCurrentChoice() throws {
		let models = RemoteAPI.readModelOptions(try JSONValue.parse(#"""
		{"models":[
			{"key":"anthropic/claude-fable-5-1","name":"Claude Fable 5.1","provider":"anthropic","thinkingLevels":["off","low",3,"high"],"defaultThinkingLevel":"high","supportsImage":true},
			{"key":"local/tiny"},
			{"name":"no key"}
		]}
		"""#))
		#expect(models == [
			RemoteModelOption(key: "anthropic/claude-fable-5-1", name: "Claude Fable 5.1", provider: "anthropic", thinkingLevels: ["off", "low", "high"], defaultThinkingLevel: "high", supportsImage: true),
			RemoteModelOption(key: "local/tiny", name: "local/tiny", provider: "local", thinkingLevels: [], supportsImage: false),
		])
		let state = RemoteAPI.readSessionState(try JSONValue.parse(#"{"status":"idle","model":"GLM 5","modelKey":"zai/glm-5","thinkingLevel":"max"}"#))
		#expect(state.modelKey == "zai/glm-5")
		#expect(state.thinkingLevel == "max")
	}

	@Test func keepsOneUploadInsideASealedFrame() {
		// base64 grows by 4/3; the relay takes ~1.05 MB of sealed JSON per frame.
		#expect((RemoteAPI.maxUploadBytes + 2) / 3 * 4 < 1_000_000)
	}
}

@Suite struct PairingURITests {
	let invite = RemotePairingInvite(
		pairingId: "pair-1234567890abcdef",
		mobileSecret: "secret-1234567890abcdef",
		desktopIdentityKey: Vectors.desktopIdentityPublic,
		desktopName: "Jane's MacBook Pro",
		lanEndpoints: ["192.168.1.20:43117", "[fe80::1%en0]:43117"],
		relayBaseUrl: "wss://relay.example"
	)

	@Test func roundTripsAnInvite() throws {
		#expect(try PairingURI.parse(PairingURI.build(invite)) == invite)
	}

	@Test func parsesTheDesktopEncodingWithPlusForSpaces() throws {
		// What URLSearchParams on the desktop emits.
		let text = "vetta://pair?v=2&id=pair-1234567890abcdef&s=secret-1234567890abcdef&k=\(Vectors.desktopIdentityPublic)&n=Jane%27s+MacBook+Pro&lan=192.168.1.20%3A43117&relay=https%3A%2F%2Frelay.example%2F"
		let parsed = try PairingURI.parse(text)
		#expect(parsed.desktopName == "Jane's MacBook Pro")
		#expect(parsed.lanEndpoints == ["192.168.1.20:43117"])
		#expect(parsed.relayBaseUrl == "wss://relay.example")
	}

	@Test func rejectsForeignOrMalformedLinks() {
		for text in ["https://example.com", "vetta://other?v=2", "vetta://pair?v=1", "vetta://pair?v=2&id=short"] {
			#expect(throws: RemoteProtocolError.self) { try PairingURI.parse(text) }
		}
	}

	@Test func validatesEndpointsAndBuildsUrls() {
		#expect(PairingURI.isValidHostPort("192.168.1.20:43117"))
		#expect(PairingURI.isValidHostPort("mac.local:1"))
		#expect(!PairingURI.isValidHostPort("192.168.1.20:70000"))
		#expect(!PairingURI.isValidHostPort("not an address"))
		#expect(PairingURI.lanControlUrl(endpoint: "a:1", pairingId: "p") == "ws://a:1/v2/lan/p")
		#expect(PairingURI.relayControlUrl(relayBaseUrl: "wss://r", pairingId: "p", role: .mobile) == "wss://r/v2/relay/p/mobile")
		#expect(PairingURI.normalizeRelayBaseUrl("http://Relay.Example:8787/base/") == "ws://relay.example:8787/base")
		#expect(PairingURI.normalizeRelayBaseUrl("ftp://x") == nil)
	}
}

@Suite struct EventJournalTests {
	@Test func replaysTheMissingTailAndSignalsEviction() {
		var clock = 0.0
		let journal = RemoteEventJournal(capacity: 3, now: { clock })
		for _ in 0 ..< 5 {
			let sequence = journal.nextSequence()
			journal.remember(RemoteEvent(eventId: "e\(sequence)", sequence: sequence, name: .sessionState))
		}
		#expect(journal.replay(after: 3)?.map(\.sequence) == [4, 5])
		#expect(journal.replay(after: 1) == nil)
		#expect(journal.replay(after: 5) == [])
		journal.acknowledge(4)
		#expect(journal.replay(after: 4)?.map(\.sequence) == [5])
		clock = 10 * 60_000
		#expect(journal.replay(after: 4) == nil)
	}
}
