import Foundation
import Testing
@testable import VettaKit

@Suite struct RemoteDesktopProtocolTests {
	@Test func readsTheSignalsTheRelayForwardsOnePerLine() throws {
		let signals = try RemoteDesktopProtocol.parseSignals("""
		{"type":"peer_ready","protocolVersion":1}
		{"type":"offer","protocolVersion":1,"sessionId":"pairing-1","sdp":"v=0\\r\\n"}
		{"type":"ice","protocolVersion":1,"sessionId":"pairing-1","candidate":"candidate:1","sdpMid":"0","sdpMLineIndex":0}
		{"type":"ice","protocolVersion":1,"sessionId":"pairing-1","candidate":"candidate:2","sdpMid":null,"sdpMLineIndex":null}
		{"type":"end","protocolVersion":1,"sessionId":"pairing-1","reason":"peer_closed"}
		""")
		#expect(signals == [
			.peerReady,
			.offer(sessionId: "pairing-1", sdp: "v=0\r\n"),
			.ice(sessionId: "pairing-1", candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0),
			.ice(sessionId: "pairing-1", candidate: "candidate:2", sdpMid: nil, sdpMLineIndex: nil),
			.end(sessionId: "pairing-1", reason: .peerClosed),
		])
	}

	@Test func refusesSignalsTheDesktopWouldRefuse() {
		for line in [
			#"{"type":"offer","protocolVersion":1,"sessionId":"s","sdp":"v=0","execute":"x"}"#,
			#"{"type":"offer","protocolVersion":2,"sessionId":"s","sdp":"v=0"}"#,
			#"{"type":"end","protocolVersion":1,"sessionId":"s","reason":"bored"}"#,
			#"{"type":"ice","protocolVersion":1,"sessionId":"s","candidate":"c","sdpMLineIndex":1.5}"#,
			#"{"type":"frame","protocolVersion":1,"sessionId":"s"}"#,
			#"not json"#,
		] {
			#expect(throws: RemoteProtocolError.self) { try RemoteDesktopProtocol.parseSignals(line) }
		}
	}

	@Test func writesSignalsItCanReadBack() throws {
		for signal: RemoteDesktopSignal in [
			.answer(sessionId: "pairing-1", sdp: "v=0\r\n"),
			.ice(sessionId: "pairing-1", candidate: "candidate:1", sdpMid: nil, sdpMLineIndex: 3),
			.end(sessionId: "pairing-1", reason: .completed),
		] {
			#expect(try RemoteDesktopProtocol.parseSignals(RemoteDesktopProtocol.encode(signal)) == [signal])
		}
	}

	@Test func keepsThePairingSecretOutOfTheSignalingUrl() {
		let viewer = RemoteDesktopProtocol.splitTarget("wss://relay.example/v2/desktop/p1/viewer#pairing=s3cret")
		#expect(viewer.url == "wss://relay.example/v2/desktop/p1/viewer")
		#expect(viewer.token == "s3cret")
		#expect(RemoteDesktopProtocol.subprotocols(token: viewer.token) == ["vetta.desktop.v1", "vetta.pairing.s3cret"])
		#expect(RemoteDesktopProtocol.splitTarget("wss://relay.example/v").token == nil)
		#expect(RemoteDesktopProtocol.splitTarget("wss://relay.example/v#bare").token == "bare")
	}

	@Test func encodesInputTheWayTheDesktopDecodesIt() throws {
		#expect(try RemoteDesktopProtocol.encode(.pointerMove(x: 0.25, y: 0.75), sequence: 1) == #"{"sequence":1,"type":"pointer.move","x":0.25,"y":0.75}"#)
		#expect(try RemoteDesktopProtocol.encode(.pointerButton(x: 0, y: 1, button: .right, action: .down), sequence: 2)
			== #"{"action":"down","button":"right","sequence":2,"type":"pointer.button","x":0,"y":1}"#)
		#expect(try RemoteDesktopProtocol.encode(.key(code: "KeyC", action: .down, modifiers: [.meta]), sequence: 3)
			== #"{"action":"down","code":"KeyC","modifiers":["meta"],"sequence":3,"type":"key"}"#)
		#expect(try RemoteDesktopProtocol.encode(.key(code: "Enter", action: .up, modifiers: []), sequence: 4)
			== #"{"action":"up","code":"Enter","sequence":4,"type":"key"}"#)
		#expect(try RemoteDesktopProtocol.encode(.text("你好 👋"), sequence: 5) == #"{"sequence":5,"text":"你好 👋","type":"text"}"#)
	}

	@Test func refusesInputTheDesktopWouldRefuse() {
		#expect(throws: RemoteProtocolError.self) { try RemoteDesktopProtocol.encode(.pointerMove(x: 1.2, y: 0), sequence: 1) }
		#expect(throws: RemoteProtocolError.self) { try RemoteDesktopProtocol.encode(.pointerScroll(deltaX: 0, deltaY: 5_000), sequence: 1) }
		#expect(throws: RemoteProtocolError.self) { try RemoteDesktopProtocol.encode(.text("a\u{1B}b"), sequence: 1) }
		#expect(throws: RemoteProtocolError.self) { try RemoteDesktopProtocol.encode(.text(String(repeating: "a", count: 257)), sequence: 1) }
		#expect(throws: RemoteProtocolError.self) { try RemoteDesktopProtocol.encode(.key(code: "KeyA", action: .down, modifiers: [.shift, .shift]), sequence: 1) }
		#expect(throws: RemoteProtocolError.self) { try RemoteDesktopProtocol.encode(.heartbeat(sentAt: 1), sequence: 0) }
	}

	@Test func typesPastedTextAsRunsAndKeys() {
		#expect(RemoteDesktopProtocol.typing("第一行\n第二行\tend\u{7}") == [
			.text("第一行"),
			.key(code: "Enter", action: .down, modifiers: []),
			.key(code: "Enter", action: .up, modifiers: []),
			.text("第二行"),
			.key(code: "Tab", action: .down, modifiers: []),
			.key(code: "Tab", action: .up, modifiers: []),
			.text("end"),
		])
		#expect(RemoteDesktopProtocol.typing("a\r\nb").count == 4, "a Windows line break is one Enter")
	}

	@Test func splitsLongTextWithoutBreakingACharacter() throws {
		let pasted = String(repeating: "a", count: 255) + "👍🏽" + String(repeating: "b", count: 300)
		let commands = RemoteDesktopProtocol.typing(pasted)
		let runs = commands.compactMap { command -> String? in
			if case let .text(run) = command { return run }
			return nil
		}
		#expect(runs.joined() == pasted)
		#expect(runs.allSatisfy { $0.utf16.count <= RemoteDesktopProtocol.maxTypedText })
		#expect(runs[0] == String(repeating: "a", count: 255), "the emoji does not fit and moves to the next run whole")
		for (index, command) in commands.enumerated() { _ = try RemoteDesktopProtocol.encode(command, sequence: index + 1) }
	}
}
