import Foundation
import Testing
@testable import VettaKit

struct InviteCodeTests {
	private let nonce = Data((0 ..< 24).map { UInt8($0) })

	@Test func matchesTheDesktopsVector() async throws {
		// Pinned in packages/remote-control/test/invite-code.test.ts.
		#expect(InviteCode.boxId("K7Q29MXD") == "oe8sfyla3JaUnRAk_OqKI8DJvl48e8IfsfQ1SK6dMS4")
		let envelope = try InviteCode.seal("vetta://pair?v=2", code: "K7Q29MXD", password: "482913", nonce: nonce)
		#expect(envelope == InviteCode.Envelope(nonce: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYX", ciphertext: "7v0nMbc3Dzwj2xiCL-L0UvCWmf7PDe03MwwUW09QZzU"))
		#expect(try await InviteCode.open(envelope, code: "K7Q29MXD", password: "482913") == "vetta://pair?v=2")
		await #expect(throws: RemoteProtocolError.self) { try await InviteCode.open(envelope, code: "K7Q29MXD", password: "482914") }
	}

	@Test func readsACodeHoweverItWasTyped() {
		#expect(InviteCode.normalize(" k7q2-9mxd ") == "K7Q29MXD")
		#expect(InviteCode.normalize("OIL00000") == "01100000")
		#expect(InviteCode.normalize("K7Q2-9MX") == nil)
		#expect(InviteCode.normalize("K7Q2-9MXU") == nil)
		#expect(!InviteCode.isValidPassword("12345"))
		#expect(!InviteCode.isValidPassword("12345a"))
		#expect(!InviteCode.isValidPassword("１２３４５６"), "full-width digits are not what the computer shows")
		#expect(InviteCode.isValidPassword("012345"))
		let box = InviteCode.boxId("K7Q29MXD")
		#expect(InviteCode.boxUrl(relayBaseUrl: "wss://relay.example/", code: "K7Q29MXD") == "https://relay.example/v2/invite/\(box)")
		#expect(InviteCode.boxUrl(relayBaseUrl: "ws://127.0.0.1:8787", code: "K7Q29MXD") == "http://127.0.0.1:8787/v2/invite/\(box)")
	}

	@Test func takesATypedRelayAsItsWebSocketAddress() {
		#expect(InviteCode.relayBaseUrl(typed: nil) == InviteCode.defaultRelayBaseUrl)
		#expect(InviteCode.relayBaseUrl(typed: "  ") == InviteCode.defaultRelayBaseUrl)
		#expect(InviteCode.relayBaseUrl(typed: "relay.example.com") == "wss://relay.example.com")
		#expect(InviteCode.relayBaseUrl(typed: "https://Relay.Example.com/") == "wss://relay.example.com")
		#expect(InviteCode.relayBaseUrl(typed: "ws://10.0.0.2:8787") == "ws://10.0.0.2:8787")
	}

	@Test func looksTheInviteUpOnTheRelayAndSaysWhyWhenItCannot() async throws {
		let envelope = try InviteCode.seal("vetta://pair?v=2&p=room", code: "K7Q29MXD", password: "482913", nonce: nonce)
		let body = Data(#"{"envelope":{"v":1,"nonce":"\#(envelope.nonce)","ciphertext":"\#(envelope.ciphertext)"}}"#.utf8)
		var asked: [String] = []
		let found = InviteCodeLookup { url in asked.append(url); return (200, body) }
		#expect(await found.lookup(code: "k7q2-9mxd", password: "482913", relayBaseUrl: "wss://relay.example") == .found("vetta://pair?v=2&p=room"))
		#expect(asked == [InviteCode.boxUrl(relayBaseUrl: "wss://relay.example", code: "K7Q29MXD")])
		#expect(await found.lookup(code: "K7Q29MXD", password: "000000", relayBaseUrl: "wss://relay.example") == .wrongPassword)
		#expect(await InviteCodeLookup { _ in (404, Data(#"{"error":"not_found"}"#.utf8)) }.lookup(code: "K7Q29MXD", password: "482913") == .notFound)
		#expect(await InviteCodeLookup { _ in nil }.lookup(code: "K7Q29MXD", password: "482913") == .unreachable)
		#expect(await InviteCodeLookup { _ in (200, Data("<html>".utf8)) }.lookup(code: "K7Q29MXD", password: "482913") == .unreachable)
		#expect(await InviteCodeLookup { _ in (503, Data()) }.lookup(code: "K7Q29MXD", password: "482913") == .unreachable)
		let never = InviteCodeLookup { _ in Issue.record("a malformed code must not reach the relay"); return nil }
		#expect(await never.lookup(code: "short", password: "482913") == .notFound)
	}

	@Test func pairsWithTheInviteLikeAScannedCode() async throws {
		let desktop = FakeDesktop()
		desktop.onHello = { _ in .approve }
		let uri = PairingURI.build(RemotePairingInvite(pairingId: "pair-1234567890abcdef", mobileSecret: "secret-1234567890abcdef", desktopIdentityKey: desktop.identityKey, desktopName: "MacBook Pro", lanEndpoints: ["192.168.1.20:43117"]))
		let envelope = try InviteCode.seal(uri, code: "K7Q29MXD", password: "482913", nonce: nonce)
		let body = Data(#"{"envelope":{"v":1,"nonce":"\#(envelope.nonce)","ciphertext":"\#(envelope.ciphertext)"}}"#.utf8)
		var asked: [String] = []
		var platform = AppPlatform.memory(createTransport: desktop.createTransport)
		platform.inviteLookup = InviteCodeLookup { url in asked.append(url); return (200, body) }
		let model = AppModel(platform: platform)
		model.start()

		#expect(await model.pairWithInvite(code: "K7Q2-9MXD", password: "000000") == false)
		#expect(model.pairing == .failed(.inviteWrongPassword))
		#expect(!model.paired)

		#expect(await model.pairWithInvite(code: "K7Q2-9MXD", password: "482913", relayBaseUrl: "relay.example"))
		#expect(model.paired)
		#expect(model.desktop?.desktopName == "MacBook Pro")
		#expect(asked.last == InviteCode.boxUrl(relayBaseUrl: "wss://relay.example", code: "K7Q29MXD"))
		model.unpair()
	}

	@Test func saysWhenTheCodeLedNowhere() async {
		let desktop = FakeDesktop()
		var platform = AppPlatform.memory(createTransport: desktop.createTransport)
		platform.inviteLookup = InviteCodeLookup { _ in (404, Data()) }
		let model = AppModel(platform: platform)
		model.start()
		#expect(await model.pairWithInvite(code: "K7Q29MXD", password: "482913") == false)
		#expect(model.pairing == .failed(.inviteNotFound))
		#expect(L10n.Pair.describe(.inviteNotFound) == L10n.Pair.inviteNotFound)
	}
}
