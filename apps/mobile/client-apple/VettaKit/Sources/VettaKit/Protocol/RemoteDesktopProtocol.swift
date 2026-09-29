import Foundation

// Port of `packages/remote-desktop/src/protocol.ts` and `types.ts`: the WebRTC
// signaling that the relay forwards between the desktop (host) and this phone
// (viewer), and the input messages the phone sends on `vetta-input-v1`. Every
// message is checked as strictly as the TypeScript side, unknown fields included.

public enum RemoteDesktopEndReason: String, Equatable, Sendable {
	case completed, revoked, failed
	case peerClosed = "peer_closed"
}

public enum RemoteDesktopSignal: Equatable, Sendable {
	/// The relay saw both ends connect; the host sends its offer next.
	case peerReady
	case offer(sessionId: String, sdp: String)
	case answer(sessionId: String, sdp: String)
	case ice(sessionId: String, candidate: String, sdpMid: String?, sdpMLineIndex: Int?)
	case end(sessionId: String, reason: RemoteDesktopEndReason)
}

public enum RemotePointerButton: String, Equatable, Sendable {
	case left, middle, right
}

public enum RemoteKeyAction: String, Equatable, Sendable {
	case down, up
}

public enum RemoteKeyModifier: String, Equatable, Sendable, CaseIterable {
	case alt, control, meta, shift
}

/// What the phone asks the desktop to do; `sequence` is added when it is sent.
public enum RemoteInputCommand: Equatable, Sendable {
	/// `x` and `y` are 0…1 across the desktop's screen.
	case pointerMove(x: Double, y: Double)
	case pointerButton(x: Double, y: Double, button: RemotePointerButton, action: RemoteKeyAction)
	/// Wheel pixels, at most 4096 either way.
	case pointerScroll(deltaX: Double, deltaY: Double)
	/// `code` is a DOM `KeyboardEvent.code` such as "KeyC" or "Enter".
	case key(code: String, action: RemoteKeyAction, modifiers: [RemoteKeyModifier])
	/// Printable text typed as is, in any language; control keys still go as `key`.
	case text(String)
	case heartbeat(sentAt: Int)
}

public enum RemoteDesktopProtocol {
	public static let version = 1
	public static let webSocketProtocol = "vetta.desktop.v1"
	public static let inputChannel = "vetta-input-v1"
	public static let controlChannel = "vetta-control-v2"
	/// The most text one input message carries.
	public static let maxTypedText = 256
	public static let maxScrollDelta = 4_096.0

	// MARK: Signaling

	/// One WebSocket message may hold several signals, one JSON object per line.
	public static func parseSignals(_ text: String) throws -> [RemoteDesktopSignal] {
		try text.split(whereSeparator: \.isNewline).map { line in
			guard let value = try? JSONValue.parse(String(line)) else { throw RemoteProtocolError("signal is not valid JSON") }
			return try decodeSignal(value)
		}
	}

	public static func decodeSignal(_ value: JSONValue) throws -> RemoteDesktopSignal {
		guard let fields = value.objectValue else { throw RemoteProtocolError("message must be an object") }
		let type = fields["type"]?.stringValue
		let allowed: Set<String> = switch type {
		case "peer_ready": ["type", "protocolVersion"]
		case "offer", "answer": ["type", "protocolVersion", "sessionId", "sdp"]
		case "ice": ["type", "protocolVersion", "sessionId", "candidate", "sdpMid", "sdpMLineIndex"]
		case "end": ["type", "protocolVersion", "sessionId", "reason"]
		default: ["type", "protocolVersion", "sessionId"]
		}
		if let unknown = fields.keys.first(where: { !allowed.contains($0) }) { throw RemoteProtocolError("unsupported field: \(unknown)") }
		let kind = try text(fields["type"], "type", 32)
		guard fields["protocolVersion"]?.numberValue == Double(version) else { throw RemoteProtocolError("unsupported desktop protocol version") }
		if kind == "peer_ready" { return .peerReady }
		let sessionId = try text(fields["sessionId"], "sessionId", 128)
		switch kind {
		case "offer": return .offer(sessionId: sessionId, sdp: try text(fields["sdp"], "sdp", 262_144))
		case "answer": return .answer(sessionId: sessionId, sdp: try text(fields["sdp"], "sdp", 262_144))
		case "ice":
			return .ice(
				sessionId: sessionId,
				candidate: try text(fields["candidate"], "candidate", 8_192),
				sdpMid: try nullableText(fields["sdpMid"], "sdpMid", 128),
				sdpMLineIndex: try nullableInteger(fields["sdpMLineIndex"], "sdpMLineIndex", 0, 65_535)
			)
		case "end":
			guard let reason = RemoteDesktopEndReason(rawValue: try text(fields["reason"], "reason", 32)) else {
				throw RemoteProtocolError("unsupported end reason")
			}
			return .end(sessionId: sessionId, reason: reason)
		default:
			throw RemoteProtocolError("unsupported signal type")
		}
	}

	/// One line, without the trailing newline the socket adds.
	public static func encode(_ signal: RemoteDesktopSignal) -> String {
		var fields: [String: JSONValue] = ["protocolVersion": .number(Double(version))]
		switch signal {
		case .peerReady:
			fields["type"] = .string("peer_ready")
		case let .offer(sessionId, sdp), let .answer(sessionId, sdp):
			if case .offer = signal { fields["type"] = .string("offer") } else { fields["type"] = .string("answer") }
			fields["sessionId"] = .string(sessionId)
			fields["sdp"] = .string(sdp)
		case let .ice(sessionId, candidate, sdpMid, sdpMLineIndex):
			fields["type"] = .string("ice")
			fields["sessionId"] = .string(sessionId)
			fields["candidate"] = .string(candidate)
			fields["sdpMid"] = sdpMid.map(JSONValue.string) ?? .null
			fields["sdpMLineIndex"] = sdpMLineIndex.map { .number(Double($0)) } ?? .null
		case let .end(sessionId, reason):
			fields["type"] = .string("end")
			fields["sessionId"] = .string(sessionId)
			fields["reason"] = .string(reason.rawValue)
		}
		return JSONValue.object(fields).serialized()
	}

	/// Splits a viewer target into the socket URL and the pairing secret. The secret
	/// never goes in the URL: it is offered as the `vetta.pairing.<secret>` subprotocol.
	public static func splitTarget(_ target: String) -> (url: String, token: String?) {
		guard let hash = target.firstIndex(of: "#") else { return (target, nil) }
		let url = String(target[..<hash])
		let fragment = String(target[target.index(after: hash)...])
		if fragment.isEmpty { return (url, nil) }
		if !fragment.contains("=") { return (url, fragment) }
		let token = URLComponents(string: "?\(fragment)")?.queryItems?.first { $0.name == "pairing" }?.value
		return (url, token?.isEmpty == false ? token : nil)
	}

	/// The subprotocols a viewer offers: the protocol, then its pairing secret.
	public static func subprotocols(token: String?) -> [String] {
		guard let token else { return [webSocketProtocol] }
		return [webSocketProtocol, "vetta.pairing.\(token)"]
	}

	// MARK: Input

	/// Validated like the desktop does, so a message it would refuse never leaves.
	public static func encode(_ command: RemoteInputCommand, sequence: Int) throws -> String {
		guard sequence >= 1 else { throw RemoteProtocolError("sequence must be positive") }
		var fields: [String: JSONValue] = ["sequence": .number(Double(sequence))]
		switch command {
		case let .pointerMove(x, y):
			fields["type"] = .string("pointer.move")
			fields["x"] = .number(try normalized(x, "x"))
			fields["y"] = .number(try normalized(y, "y"))
		case let .pointerButton(x, y, button, action):
			fields["type"] = .string("pointer.button")
			fields["x"] = .number(try normalized(x, "x"))
			fields["y"] = .number(try normalized(y, "y"))
			fields["button"] = .string(button.rawValue)
			fields["action"] = .string(action.rawValue)
		case let .pointerScroll(deltaX, deltaY):
			fields["type"] = .string("pointer.scroll")
			fields["deltaX"] = .number(try bounded(deltaX, "deltaX", -maxScrollDelta, maxScrollDelta))
			fields["deltaY"] = .number(try bounded(deltaY, "deltaY", -maxScrollDelta, maxScrollDelta))
		case let .key(code, action, modifiers):
			fields["type"] = .string("key")
			guard !code.isEmpty, code.utf16.count <= 64 else { throw RemoteProtocolError("code must be a non-empty string of at most 64 characters") }
			guard Set(modifiers).count == modifiers.count else { throw RemoteProtocolError("modifiers contain duplicate values") }
			fields["code"] = .string(code)
			fields["action"] = .string(action.rawValue)
			if !modifiers.isEmpty { fields["modifiers"] = .array(modifiers.map { .string($0.rawValue) }) }
		case let .text(typed):
			fields["type"] = .string("text")
			guard !typed.isEmpty, typed.utf16.count <= maxTypedText else { throw RemoteProtocolError("text must be a non-empty string of at most \(maxTypedText) characters") }
			guard !typed.unicodeScalars.contains(where: { $0.properties.generalCategory == .control }) else {
				throw RemoteProtocolError("text must not contain control characters")
			}
			fields["text"] = .string(typed)
		case let .heartbeat(sentAt):
			fields["type"] = .string("heartbeat")
			guard sentAt >= 0 else { throw RemoteProtocolError("sentAt must not be negative") }
			fields["sentAt"] = .number(Double(sentAt))
		}
		return JSONValue.object(fields).serialized()
	}

	/// Pasted or typed text as the messages that carry it: printable runs as `text`,
	/// each at most `maxTypedText` UTF-16 units and never splitting a character; line
	/// breaks and tabs as their keys; any other control character dropped.
	public static func typing(_ input: String) -> [RemoteInputCommand] {
		var commands: [RemoteInputCommand] = []
		var run = ""
		func flush() {
			if !run.isEmpty { commands.append(.text(run)) }
			run = ""
		}
		func press(_ code: String) {
			flush()
			commands.append(.key(code: code, action: .down, modifiers: []))
			commands.append(.key(code: code, action: .up, modifiers: []))
		}
		for character in input {
			if character == "\r\n" || character == "\n" || character == "\r" {
				press("Enter")
			} else if character == "\t" {
				press("Tab")
			} else if character.unicodeScalars.contains(where: { $0.properties.generalCategory == .control }) {
				continue
			} else {
				if run.utf16.count + character.utf16.count > maxTypedText { flush() }
				run.append(character)
			}
		}
		flush()
		return commands
	}

	// MARK: Checks

	private static func text(_ value: JSONValue?, _ field: String, _ maximum: Int) throws -> String {
		guard let value = value?.stringValue, !value.isEmpty, value.utf16.count <= maximum else {
			throw RemoteProtocolError("\(field) must be a non-empty string of at most \(maximum) characters")
		}
		return value
	}

	private static func nullableText(_ value: JSONValue?, _ field: String, _ maximum: Int) throws -> String? {
		if value == nil || value == .null { return nil }
		return try text(value, field, maximum)
	}

	private static func nullableInteger(_ value: JSONValue?, _ field: String, _ minimum: Int, _ maximum: Int) throws -> Int? {
		if value == nil || value == .null { return nil }
		guard let number = value?.numberValue, number == number.rounded(), number >= Double(minimum), number <= Double(maximum) else {
			throw RemoteProtocolError("\(field) must be an integer between \(minimum) and \(maximum)")
		}
		return Int(number)
	}

	private static func normalized(_ value: Double, _ field: String) throws -> Double {
		try bounded(value, field, 0, 1)
	}

	private static func bounded(_ value: Double, _ field: String, _ minimum: Double, _ maximum: Double) throws -> Double {
		guard value.isFinite, value >= minimum, value <= maximum else { throw RemoteProtocolError("\(field) must be between \(minimum) and \(maximum)") }
		return value
	}
}
