import Foundation

/// Payload contracts carried inside requests, responses and events (port of `api.ts`).
/// Readers are tolerant: unknown fields are dropped and malformed entries skipped.
public enum RemoteSessionStatus: String, Codable, Sendable, CaseIterable {
	case idle
	case running
	case thinking
	case waitingInput = "waiting_input"
	case completed
	case error
	case aborted

	public var isActive: Bool { self == .running || self == .thinking || self == .waitingInput }
}

public struct RemoteProjectSummary: Equatable, Codable, Sendable {
	public var cwd: String
	public var name: String
	/// "conversation" for the desktop's project-less chats, otherwise "project".
	public var kind: String
	public var sessionCount: Double

	public init(cwd: String, name: String, kind: String, sessionCount: Double) {
		self.cwd = cwd
		self.name = name
		self.kind = kind
		self.sessionCount = sessionCount
	}

	public var isConversation: Bool { kind == "conversation" }
}

public struct RemoteSessionSummary: Equatable, Codable, Sendable, Identifiable {
	public var id: String
	public var projectCwd: String
	public var projectName: String
	public var title: String
	public var preview: String?
	public var updatedAt: Double
	public var status: RemoteSessionStatus
	/// True when the desktop currently holds a live runtime instance for it.
	public var live: Bool

	public init(id: String, projectCwd: String, projectName: String, title: String, preview: String? = nil, updatedAt: Double, status: RemoteSessionStatus, live: Bool) {
		self.id = id
		self.projectCwd = projectCwd
		self.projectName = projectName
		self.title = title
		self.preview = preview
		self.updatedAt = updatedAt
		self.status = status
		self.live = live
	}
}

public struct RemoteQuestionOption: Equatable, Codable, Sendable {
	public var label: String
	public var description: String
}

public struct RemoteQuestionItem: Equatable, Codable, Sendable {
	public var question: String
	public var header: String
	public var options: [RemoteQuestionOption]
	public var multiSelect: Bool
}

public struct RemoteQuestionRequest: Equatable, Codable, Sendable {
	public var requestId: String
	public var questions: [RemoteQuestionItem]
}

public struct RemoteQuestionAnswer: Equatable, Sendable {
	public var question: String
	public var answers: [String]

	public init(question: String, answers: [String]) {
		self.question = question
		self.answers = answers
	}

	var json: JSONValue { ["question": .string(question), "answers": .array(answers.map(JSONValue.string))] }
}

public struct RemoteSessionError: Equatable, Codable, Sendable {
	public var code: String
	public var message: String
}

public struct RemoteSessionState: Equatable, Codable, Sendable {
	public var status: RemoteSessionStatus
	public var detail: String?
	public var model: String?
	public var contextPercent: Double?
	public var error: RemoteSessionError?
	/// Present while the desktop waits for an answer that the phone may give.
	public var pendingQuestion: RemoteQuestionRequest?

	public init(status: RemoteSessionStatus, detail: String? = nil, model: String? = nil, contextPercent: Double? = nil, error: RemoteSessionError? = nil, pendingQuestion: RemoteQuestionRequest? = nil) {
		self.status = status
		self.detail = detail
		self.model = model
		self.contextPercent = contextPercent
		self.error = error
		self.pendingQuestion = pendingQuestion
	}
}

public enum RemoteToolPhase: String, Sendable {
	case generating, started, updated, phase, completed, failed
}

public struct RemoteToolEvent: Equatable, Sendable {
	public var toolCallId: String
	public var toolName: String
	public var phase: RemoteToolPhase
	public var args: String?
	public var result: String?
	public var label: String?
	public var durationMs: Double?

	public init(toolCallId: String, toolName: String, phase: RemoteToolPhase, args: String? = nil, result: String? = nil, label: String? = nil, durationMs: Double? = nil) {
		self.toolCallId = toolCallId
		self.toolName = toolName
		self.phase = phase
		self.args = args
		self.result = result
		self.label = label
		self.durationMs = durationMs
	}
}

public enum RemoteMessageEvent: Equatable, Sendable {
	case user(text: String, at: Double)
	case assistantDelta(String)
	case thinkingDelta(String)
	case turnEnd(at: Double)
}

public struct RemoteToolCallSummary: Equatable, Sendable {
	public var toolCallId: String
	public var toolName: String
	public var args: String?
	public var result: String?
	public var isError: Bool
	public var durationMs: Double?

	public init(toolCallId: String, toolName: String, args: String? = nil, result: String? = nil, isError: Bool = false, durationMs: Double? = nil) {
		self.toolCallId = toolCallId
		self.toolName = toolName
		self.args = args
		self.result = result
		self.isError = isError
		self.durationMs = durationMs
	}
}

public enum RemoteTranscriptEntry: Equatable, Sendable {
	case user(id: String, text: String, at: Double?)
	case assistant(id: String, text: String, thinking: String?, toolCalls: [RemoteToolCallSummary], at: Double?, error: String?)
	case marker(id: String, text: String, at: Double?)
}

public struct RemoteDeviceStatus: Equatable, Sendable {
	public var deviceName: String
	public var osLabel: String?
	public var lanEndpoints: [String]
	public var relayEnabled: Bool
	public var runningSessionCount: Double
}

/// Sealed follow-up to a manual pairing approval; carries the long-lived credential.
public struct RemoteDevicePaired: Equatable, Sendable {
	public var pairingId: String
	public var mobileSecret: String
	public var desktopName: String
	public var lanEndpoints: [String]
	public var relayBaseUrl: String?
}

public enum RemoteAPI {
	public static func readSessionStatus(_ value: JSONValue?) -> RemoteSessionStatus {
		value?.stringValue.flatMap(RemoteSessionStatus.init(rawValue:)) ?? .idle
	}

	public static func readSessionSummary(_ value: JSONValue?) -> RemoteSessionSummary? {
		guard let value, value.isObject,
		      let id = nonEmpty(value["id"]?.stringValue),
		      let projectCwd = nonEmpty(value["projectCwd"]?.stringValue)
		else { return nil }
		return RemoteSessionSummary(
			id: id,
			projectCwd: projectCwd,
			projectName: value["projectName"]?.stringValue ?? projectCwd,
			title: value["title"]?.stringValue ?? "",
			preview: value["preview"]?.stringValue,
			updatedAt: value["updatedAt"]?.numberValue ?? 0,
			status: readSessionStatus(value["status"]),
			live: value["live"]?.boolValue == true
		)
	}

	public static func readSessionSummaries(_ value: JSONValue?) -> [RemoteSessionSummary] {
		(value?["sessions"]?.arrayValue ?? []).compactMap(readSessionSummary)
	}

	public static func readQuestionRequest(_ value: JSONValue?) -> RemoteQuestionRequest? {
		guard let value, value.isObject, let requestId = nonEmpty(value["requestId"]?.stringValue),
		      let list = value["questions"]?.arrayValue
		else { return nil }
		let questions = list.filter(\.isObject).compactMap { item -> RemoteQuestionItem? in
			guard let question = nonEmpty(item["question"]?.stringValue) else { return nil }
			let options = (item["options"]?.arrayValue ?? []).filter(\.isObject).compactMap { option -> RemoteQuestionOption? in
				guard let label = nonEmpty(option["label"]?.stringValue) else { return nil }
				return RemoteQuestionOption(label: label, description: option["description"]?.stringValue ?? "")
			}
			return RemoteQuestionItem(
				question: question,
				header: item["header"]?.stringValue ?? "",
				options: options,
				multiSelect: item["multiSelect"]?.boolValue == true
			)
		}
		return RemoteQuestionRequest(requestId: requestId, questions: questions)
	}

	public static func readSessionState(_ value: JSONValue?) -> RemoteSessionState {
		guard let value, value.isObject else { return RemoteSessionState(status: .idle) }
		let error = value["error"].flatMap { error -> RemoteSessionError? in
			guard error.isObject else { return nil }
			return RemoteSessionError(
				code: error["code"]?.stringValue ?? "internal_error",
				message: error["message"]?.stringValue ?? ""
			)
		}
		return RemoteSessionState(
			status: readSessionStatus(value["status"]),
			detail: value["detail"]?.stringValue,
			model: value["model"]?.stringValue,
			contextPercent: value["contextPercent"]?.numberValue,
			error: error,
			pendingQuestion: readQuestionRequest(value["pendingQuestion"])
		)
	}

	public static func readToolEvent(_ value: JSONValue?) -> RemoteToolEvent? {
		guard let value, value.isObject,
		      let toolCallId = nonEmpty(value["toolCallId"]?.stringValue),
		      let toolName = nonEmpty(value["toolName"]?.stringValue),
		      let phase = value["phase"]?.stringValue.flatMap(RemoteToolPhase.init(rawValue:))
		else { return nil }
		return RemoteToolEvent(
			toolCallId: toolCallId,
			toolName: toolName,
			phase: phase,
			args: value["args"]?.stringValue,
			result: value["result"]?.stringValue,
			label: value["label"]?.stringValue,
			durationMs: value["durationMs"]?.numberValue
		)
	}

	public static func readMessageEvent(_ value: JSONValue?, now: () -> Double = WallClock.nowMs) -> RemoteMessageEvent? {
		guard let value, value.isObject else { return nil }
		switch value["kind"]?.stringValue {
		case "user":
			guard let text = value["text"]?.stringValue else { return nil }
			return .user(text: text, at: value["at"]?.numberValue ?? now())
		case "assistant_delta":
			return value["text"]?.stringValue.map(RemoteMessageEvent.assistantDelta)
		case "thinking_delta":
			return value["text"]?.stringValue.map(RemoteMessageEvent.thinkingDelta)
		case "turn_end":
			return .turnEnd(at: value["at"]?.numberValue ?? now())
		default:
			return nil
		}
	}

	public static func readTranscriptEntries(_ value: JSONValue?) -> [RemoteTranscriptEntry] {
		(value?["entries"]?.arrayValue ?? []).compactMap { entry -> RemoteTranscriptEntry? in
			guard entry.isObject, let id = nonEmpty(entry["id"]?.stringValue) else { return nil }
			switch entry["kind"]?.stringValue {
			case "user":
				return .user(id: id, text: entry["text"]?.stringValue ?? "", at: entry["at"]?.numberValue)
			case "assistant":
				let calls = (entry["toolCalls"]?.arrayValue ?? []).filter(\.isObject).compactMap { call -> RemoteToolCallSummary? in
					guard let toolCallId = nonEmpty(call["toolCallId"]?.stringValue),
					      let toolName = nonEmpty(call["toolName"]?.stringValue)
					else { return nil }
					return RemoteToolCallSummary(
						toolCallId: toolCallId,
						toolName: toolName,
						args: call["args"]?.stringValue,
						result: call["result"]?.stringValue,
						isError: call["isError"]?.boolValue == true,
						durationMs: call["durationMs"]?.numberValue
					)
				}
				return .assistant(
					id: id,
					text: entry["text"]?.stringValue ?? "",
					thinking: entry["thinking"]?.stringValue,
					toolCalls: calls,
					at: entry["at"]?.numberValue,
					error: entry["error"]?.stringValue
				)
			case "marker":
				return .marker(id: id, text: entry["text"]?.stringValue ?? "", at: entry["at"]?.numberValue)
			default:
				return nil
			}
		}
	}

	public static func readDeviceStatus(_ value: JSONValue?) -> RemoteDeviceStatus? {
		guard let value, value.isObject, let deviceName = nonEmpty(value["deviceName"]?.stringValue) else { return nil }
		return RemoteDeviceStatus(
			deviceName: deviceName,
			osLabel: value["osLabel"]?.stringValue,
			lanEndpoints: (value["lanEndpoints"]?.arrayValue ?? []).compactMap(\.stringValue),
			relayEnabled: value["relayEnabled"]?.boolValue == true,
			runningSessionCount: value["runningSessionCount"]?.numberValue ?? 0
		)
	}

	public static func readDevicePaired(_ value: JSONValue?) -> RemoteDevicePaired? {
		guard let value, value.isObject,
		      let pairingId = nonEmpty(value["pairingId"]?.stringValue),
		      let mobileSecret = nonEmpty(value["mobileSecret"]?.stringValue),
		      let desktopName = nonEmpty(value["desktopName"]?.stringValue)
		else { return nil }
		return RemoteDevicePaired(
			pairingId: pairingId,
			mobileSecret: mobileSecret,
			desktopName: desktopName,
			lanEndpoints: (value["lanEndpoints"]?.arrayValue ?? []).compactMap(\.stringValue),
			relayBaseUrl: value["relayBaseUrl"]?.stringValue
		)
	}

	public static func readProjectSummaries(_ value: JSONValue?) -> [RemoteProjectSummary] {
		(value?["projects"]?.arrayValue ?? []).compactMap { entry -> RemoteProjectSummary? in
			guard entry.isObject, let cwd = nonEmpty(entry["cwd"]?.stringValue) else { return nil }
			return RemoteProjectSummary(
				cwd: cwd,
				name: entry["name"]?.stringValue ?? cwd,
				kind: entry["kind"]?.stringValue == "conversation" ? "conversation" : "project",
				sessionCount: entry["sessionCount"]?.numberValue ?? 0
			)
		}
	}

	/// JS truthiness for strings: empty strings count as missing.
	private static func nonEmpty(_ text: String?) -> String? {
		guard let text, !text.isEmpty else { return nil }
		return text
	}
}
