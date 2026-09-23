import Foundation

/// Swift port of `@vetta/remote-control` protocol v2 frames (`types.ts` + `protocol.ts`).
/// The TypeScript package stays the source of truth; `schemas/remote-frame.schema.json`
/// is the language-neutral contract this file must keep matching.
public let remoteProtocolVersion = 2

public enum RemoteRole: String, Sendable {
	case mobile
	case desktop
}

public enum RemoteConnectionState: String, Sendable {
	case idle
	case connecting
	case pendingApproval = "pending_approval"
	case online
	case recovering
	case reconnecting
	case closed
	case failed
}

public struct RemoteCapabilities: Equatable, Sendable {
	public var chat: Bool
	public var sessionRead: Bool
	public var fileRead: Bool?
	public var fileWrite: Bool?
	public var terminal: Bool?
	public var screen: Bool?
	public var input: Bool?

	public init(chat: Bool, sessionRead: Bool, fileRead: Bool? = nil, fileWrite: Bool? = nil, terminal: Bool? = nil, screen: Bool? = nil, input: Bool? = nil) {
		self.chat = chat
		self.sessionRead = sessionRead
		self.fileRead = fileRead
		self.fileWrite = fileWrite
		self.terminal = terminal
		self.screen = screen
		self.input = input
	}
}

public struct RemoteHello: Equatable, Sendable {
	public var role: RemoteRole
	public var deviceId: String
	public var deviceName: String
	public var capabilities: RemoteCapabilities
	public var connectionId: String
	public var identityKey: String
	public var ephemeralKey: String
}

public struct RemoteHelloAck: Equatable, Sendable {
	public var connectionId: String
	public var peerDeviceId: String
	public var peerIdentityKey: String
	public var peerEphemeralKey: String
}

public struct RemotePairingPending: Equatable, Sendable {
	public var connectionId: String
	public var peerDeviceId: String
	public var peerIdentityKey: String
}

public struct RemoteSealed: Equatable, Sendable {
	public var nonce: String
	public var ciphertext: String
}

public enum RemoteRequestMethod: String, Sendable, CaseIterable {
	case projectList = "project.list"
	case sessionList = "session.list"
	case sessionCreate = "session.create"
	case sessionOpen = "session.open"
	case sessionHistory = "session.history"
	case sessionPrompt = "session.prompt"
	case sessionUpload = "session.upload"
	case modelList = "model.list"
	case sessionConfigure = "session.configure"
	case sessionRename = "session.rename"
	case sessionPin = "session.pin"
	case sessionDelete = "session.delete"
	case sessionRespond = "session.respond"
	case sessionAbort = "session.abort"
	case sessionResume = "session.resume"
	case diagnosticsSnapshot = "diagnostics.snapshot"
}

public struct RemoteRequest: Equatable, Sendable {
	public var requestId: String
	public var method: RemoteRequestMethod
	public var sessionId: String?
	public var payload: JSONValue?
}

public enum RemoteErrorCode: String, Sendable {
	case invalidFrame = "invalid_frame"
	case unsupportedVersion = "unsupported_version"
	case unauthorized
	case approvalRejected = "approval_rejected"
	case notFound = "not_found"
	case busy
	case requestTimeout = "request_timeout"
	case transportClosed = "transport_closed"
	case internalError = "internal_error"
}

public struct RemoteError: Equatable, Sendable {
	public var code: RemoteErrorCode
	public var message: String
	public var retryable: Bool

	public init(code: RemoteErrorCode, message: String, retryable: Bool) {
		self.code = code
		self.message = message
		self.retryable = retryable
	}
}

public struct RemoteResponse: Equatable, Sendable {
	public var requestId: String
	public var success: Bool
	public var payload: JSONValue?
	public var error: RemoteError?
}

public enum RemoteEventName: String, Sendable, CaseIterable {
	case deviceStatus = "device.status"
	case devicePaired = "device.paired"
	case sessionList = "session.list"
	case sessionState = "session.state"
	case sessionMessage = "session.message"
	case sessionTool = "session.tool"
	case sessionInput = "session.input"
	case sessionResync = "session.resync"
	case diagnosticsUpdated = "diagnostics.updated"
}

public struct RemoteEvent: Equatable, Sendable {
	public var eventId: String
	public var sequence: Int
	public var name: RemoteEventName
	public var sessionId: String?
	public var payload: JSONValue?

	public init(eventId: String, sequence: Int, name: RemoteEventName, sessionId: String? = nil, payload: JSONValue? = nil) {
		self.eventId = eventId
		self.sequence = sequence
		self.name = name
		self.sessionId = sessionId
		self.payload = payload
	}
}

public enum RemoteFrame: Equatable, Sendable {
	case hello(RemoteHello)
	case helloAck(RemoteHelloAck)
	case pairingPending(RemotePairingPending)
	case peerStatus(online: Bool)
	case sealed(RemoteSealed)
	case request(RemoteRequest)
	case response(RemoteResponse)
	case event(RemoteEvent)
	case ack(sequence: Int)
	case resume(lastEventSequence: Int)

	public var typeName: String {
		switch self {
		case .hello: "hello"
		case .helloAck: "hello_ack"
		case .pairingPending: "pairing_pending"
		case .peerStatus: "peer_status"
		case .sealed: "sealed"
		case .request: "request"
		case .response: "response"
		case .event: "event"
		case .ack: "ack"
		case .resume: "resume"
		}
	}

	/// Frames that may travel in clear.
	public var isHandshake: Bool {
		switch self {
		case .hello, .helloAck, .pairingPending, .peerStatus: true
		default: false
		}
	}

	/// Frames that must travel inside a `sealed` envelope.
	public var isSession: Bool {
		if case .sealed = self { return false }
		return !isHandshake
	}
}

public struct RemoteProtocolError: Error, Equatable, CustomStringConvertible {
	public let message: String
	public var code: RemoteErrorCode { .invalidFrame }
	public init(_ message: String) { self.message = message }
	public var description: String { message }
}

// MARK: - Decoding (validates every untrusted frame, mirrors decodeRemoteFrame)

private let publicKeyPattern = try! NSRegularExpression(pattern: "^[A-Za-z0-9_-]{43}$")
private let noncePattern = try! NSRegularExpression(pattern: "^[A-Za-z0-9_-]{32}$")
private let base64UrlPattern = try! NSRegularExpression(pattern: "^[A-Za-z0-9_-]+$")
public let maxSealedCiphertextChars = 1_400_000

func matches(_ regex: NSRegularExpression, _ text: String) -> Bool {
	regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
}

private func record(_ value: JSONValue?) throws -> [String: JSONValue] {
	guard let fields = value?.objectValue else { throw RemoteProtocolError("frame must be an object") }
	return fields
}

private func requiredString(_ value: JSONValue?, _ field: String, maxLength: Int = 512) throws -> String {
	guard let text = value?.stringValue, !text.isEmpty, text.utf16.count <= maxLength else {
		throw RemoteProtocolError("\(field) must be a non-empty string")
	}
	return text
}

private func optionalString(_ value: JSONValue?, _ field: String, maxLength: Int = 256) throws -> String? {
	guard let value else { return nil }
	return try requiredString(value, field, maxLength: maxLength)
}

private func requiredBoolean(_ value: JSONValue?, _ field: String) throws -> Bool {
	guard let flag = value?.boolValue else { throw RemoteProtocolError("\(field) must be boolean") }
	return flag
}

private func optionalBoolean(_ value: JSONValue?, _ field: String) throws -> Bool? {
	guard let value else { return nil }
	return try requiredBoolean(value, field)
}

private func requiredInteger(_ value: JSONValue?, _ field: String, minimum: Int = 0) throws -> Int {
	guard let number = value?.numberValue, number == number.rounded(), abs(number) <= 9_007_199_254_740_991,
	      number >= Double(minimum)
	else { throw RemoteProtocolError("\(field) must be an integer >= \(minimum)") }
	return Int(number)
}

private func publicKey(_ value: JSONValue?, _ field: String) throws -> String {
	let text = try requiredString(value, field, maxLength: 64)
	guard matches(publicKeyPattern, text) else { throw RemoteProtocolError("\(field) must be a base64url X25519 key") }
	return text
}

private func requiredVersion(_ value: JSONValue?) throws {
	guard value?.numberValue == Double(remoteProtocolVersion) else {
		throw RemoteProtocolError("unsupported protocol version")
	}
}

private func capabilities(_ value: JSONValue?) throws -> RemoteCapabilities {
	let input = try record(value)
	return RemoteCapabilities(
		chat: try requiredBoolean(input["chat"], "capabilities.chat"),
		sessionRead: try requiredBoolean(input["sessionRead"], "capabilities.sessionRead"),
		fileRead: try optionalBoolean(input["fileRead"], "capabilities.fileRead"),
		fileWrite: try optionalBoolean(input["fileWrite"], "capabilities.fileWrite"),
		terminal: try optionalBoolean(input["terminal"], "capabilities.terminal"),
		screen: try optionalBoolean(input["screen"], "capabilities.screen"),
		input: try optionalBoolean(input["input"], "capabilities.input")
	)
}

private func remoteError(_ value: JSONValue?) throws -> RemoteError {
	let input = try record(value)
	let code = try requiredString(input["code"], "error.code")
	guard let parsed = RemoteErrorCode(rawValue: code) else { throw RemoteProtocolError("error.code is unsupported") }
	return RemoteError(
		code: parsed,
		message: try requiredString(input["message"], "error.message"),
		retryable: try requiredBoolean(input["retryable"], "error.retryable")
	)
}

extension RemoteFrame {
	public static func decode(_ value: JSONValue) throws -> RemoteFrame {
		let input = try record(value)
		let type = try requiredString(input["type"], "type")
		switch type {
		case "hello":
			let role = try requiredString(input["role"], "role")
			guard let parsedRole = RemoteRole(rawValue: role) else {
				throw RemoteProtocolError("role must be mobile or desktop")
			}
			try requiredVersion(input["protocolVersion"])
			return .hello(RemoteHello(
				role: parsedRole,
				deviceId: try requiredString(input["deviceId"], "deviceId", maxLength: 256),
				deviceName: try requiredString(input["deviceName"], "deviceName", maxLength: 128),
				capabilities: try capabilities(input["capabilities"]),
				connectionId: try requiredString(input["connectionId"], "connectionId", maxLength: 256),
				identityKey: try publicKey(input["identityKey"], "identityKey"),
				ephemeralKey: try publicKey(input["ephemeralKey"], "ephemeralKey")
			))
		case "hello_ack":
			try requiredVersion(input["protocolVersion"])
			return .helloAck(RemoteHelloAck(
				connectionId: try requiredString(input["connectionId"], "connectionId", maxLength: 256),
				peerDeviceId: try requiredString(input["peerDeviceId"], "peerDeviceId", maxLength: 256),
				peerIdentityKey: try publicKey(input["peerIdentityKey"], "peerIdentityKey"),
				peerEphemeralKey: try publicKey(input["peerEphemeralKey"], "peerEphemeralKey")
			))
		case "pairing_pending":
			return .pairingPending(RemotePairingPending(
				connectionId: try requiredString(input["connectionId"], "connectionId", maxLength: 256),
				peerDeviceId: try requiredString(input["peerDeviceId"], "peerDeviceId", maxLength: 256),
				peerIdentityKey: try publicKey(input["peerIdentityKey"], "peerIdentityKey")
			))
		case "peer_status":
			return .peerStatus(online: try requiredBoolean(input["online"], "online"))
		case "sealed":
			let nonce = try requiredString(input["nonce"], "nonce", maxLength: 64)
			guard matches(noncePattern, nonce) else { throw RemoteProtocolError("nonce must be a base64url 24-byte value") }
			let ciphertext = try requiredString(input["ciphertext"], "ciphertext", maxLength: maxSealedCiphertextChars)
			guard matches(base64UrlPattern, ciphertext) else { throw RemoteProtocolError("ciphertext must be base64url") }
			return .sealed(RemoteSealed(nonce: nonce, ciphertext: ciphertext))
		case "request":
			let method = try requiredString(input["method"], "method")
			guard let parsed = RemoteRequestMethod(rawValue: method) else {
				throw RemoteProtocolError("unsupported request method")
			}
			return .request(RemoteRequest(
				requestId: try requiredString(input["requestId"], "requestId", maxLength: 256),
				method: parsed,
				sessionId: try optionalString(input["sessionId"], "sessionId"),
				payload: input["payload"]
			))
		case "response":
			let success = try requiredBoolean(input["success"], "success")
			let error = input["error"]
			if success, error != nil { throw RemoteProtocolError("successful response must not include error") }
			if !success, error == nil { throw RemoteProtocolError("failed response must include error") }
			return .response(RemoteResponse(
				requestId: try requiredString(input["requestId"], "requestId", maxLength: 256),
				success: success,
				payload: input["payload"],
				error: try error.map(remoteError)
			))
		case "event":
			let name = try requiredString(input["name"], "name")
			guard let parsed = RemoteEventName(rawValue: name) else { throw RemoteProtocolError("unsupported event name") }
			return .event(RemoteEvent(
				eventId: try requiredString(input["eventId"], "eventId", maxLength: 256),
				sequence: try requiredInteger(input["sequence"], "sequence", minimum: 1),
				name: parsed,
				sessionId: try optionalString(input["sessionId"], "sessionId"),
				payload: input["payload"]
			))
		case "ack":
			return .ack(sequence: try requiredInteger(input["sequence"], "sequence", minimum: 1))
		case "resume":
			return .resume(lastEventSequence: try requiredInteger(input["lastEventSequence"], "lastEventSequence"))
		default:
			throw RemoteProtocolError("unsupported frame type: \(type)")
		}
	}

	/// Decodes a frame carried inside a sealed envelope; handshake frames are never valid there.
	public static func decodeSession(_ value: JSONValue) throws -> RemoteFrame {
		let frame = try decode(value)
		guard frame.isSession else { throw RemoteProtocolError("\(frame.typeName) must not be sealed") }
		return frame
	}

	public static func parse(line: String) throws -> RemoteFrame {
		let value: JSONValue
		do {
			value = try JSONValue.parse(line)
		} catch {
			throw RemoteProtocolError("frame is not valid JSON")
		}
		return try decode(value)
	}

	// MARK: Encoding

	public var json: JSONValue {
		var fields: [String: JSONValue] = ["type": .string(typeName)]
		switch self {
		case let .hello(hello):
			fields["protocolVersion"] = .number(Double(remoteProtocolVersion))
			fields["role"] = .string(hello.role.rawValue)
			fields["deviceId"] = .string(hello.deviceId)
			fields["deviceName"] = .string(hello.deviceName)
			var caps: [String: JSONValue] = ["chat": .bool(hello.capabilities.chat), "sessionRead": .bool(hello.capabilities.sessionRead)]
			if let value = hello.capabilities.fileRead { caps["fileRead"] = .bool(value) }
			if let value = hello.capabilities.fileWrite { caps["fileWrite"] = .bool(value) }
			if let value = hello.capabilities.terminal { caps["terminal"] = .bool(value) }
			if let value = hello.capabilities.screen { caps["screen"] = .bool(value) }
			if let value = hello.capabilities.input { caps["input"] = .bool(value) }
			fields["capabilities"] = .object(caps)
			fields["connectionId"] = .string(hello.connectionId)
			fields["identityKey"] = .string(hello.identityKey)
			fields["ephemeralKey"] = .string(hello.ephemeralKey)
		case let .helloAck(ack):
			fields["protocolVersion"] = .number(Double(remoteProtocolVersion))
			fields["connectionId"] = .string(ack.connectionId)
			fields["peerDeviceId"] = .string(ack.peerDeviceId)
			fields["peerIdentityKey"] = .string(ack.peerIdentityKey)
			fields["peerEphemeralKey"] = .string(ack.peerEphemeralKey)
		case let .pairingPending(pending):
			fields["connectionId"] = .string(pending.connectionId)
			fields["peerDeviceId"] = .string(pending.peerDeviceId)
			fields["peerIdentityKey"] = .string(pending.peerIdentityKey)
		case let .peerStatus(online):
			fields["online"] = .bool(online)
		case let .sealed(sealed):
			fields["nonce"] = .string(sealed.nonce)
			fields["ciphertext"] = .string(sealed.ciphertext)
		case let .request(request):
			fields["requestId"] = .string(request.requestId)
			fields["method"] = .string(request.method.rawValue)
			if let sessionId = request.sessionId { fields["sessionId"] = .string(sessionId) }
			if let payload = request.payload { fields["payload"] = payload }
		case let .response(response):
			fields["requestId"] = .string(response.requestId)
			fields["success"] = .bool(response.success)
			if let payload = response.payload { fields["payload"] = payload }
			if let error = response.error {
				fields["error"] = [
					"code": .string(error.code.rawValue),
					"message": .string(error.message),
					"retryable": .bool(error.retryable),
				]
			}
		case let .event(event):
			fields["eventId"] = .string(event.eventId)
			fields["sequence"] = .number(Double(event.sequence))
			fields["name"] = .string(event.name.rawValue)
			if let sessionId = event.sessionId { fields["sessionId"] = .string(sessionId) }
			if let payload = event.payload { fields["payload"] = payload }
		case let .ack(sequence):
			fields["sequence"] = .number(Double(sequence))
		case let .resume(lastEventSequence):
			fields["lastEventSequence"] = .number(Double(lastEventSequence))
		}
		return .object(fields)
	}

	/// One newline-terminated JSON line, as `encodeRemoteFrame` produces.
	public func encodedLine() -> String {
		json.serialized() + "\n"
	}
}
