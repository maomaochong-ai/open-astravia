import Foundation

public enum ToolCardStatus: String, Codable, Sendable {
	case generating, running, done, failed
}

public struct ToolCard: Equatable, Codable, Sendable, Identifiable {
	public var toolCallId: String
	public var toolName: String
	public var status: ToolCardStatus
	public var args: String?
	public var result: String?
	public var label: String?
	public var durationMs: Double?

	public var id: String { toolCallId }
}

public struct AssistantTurn: Equatable, Codable, Sendable {
	public var id: String
	public var text: String
	public var thinking: String
	public var tools: [ToolCard]
	public var streaming: Bool
	public var at: Double?
	public var error: String?
}

/// A picture or file sent with a prompt from this phone, shown on its bubble.
public struct TranscriptAttachment: Equatable, Codable, Sendable {
	public var kind: PromptAttachment.Kind
	public var name: String

	public init(kind: PromptAttachment.Kind, name: String) {
		self.kind = kind
		self.name = name
	}
}

public enum TranscriptItem: Equatable, Codable, Sendable, Identifiable {
	case user(id: String, text: String, at: Double?, attachments: [TranscriptAttachment] = [])
	case assistant(AssistantTurn)
	case marker(id: String, text: String, at: Double?)

	public var id: String {
		switch self {
		case let .user(id, _, _, _): id
		case let .assistant(turn): turn.id
		case let .marker(id, _, _): id
		}
	}

	public var at: Double? {
		switch self {
		case let .user(_, _, at, _): at
		case let .assistant(turn): turn.at
		case let .marker(_, _, at): at
		}
	}
}

public struct TranscriptState: Equatable, Sendable {
	public var items: [TranscriptItem]
	public var sessionState: RemoteSessionState
	public var pendingQuestion: RemoteQuestionRequest?
	/// Set after `session.resync`; the owner must refetch history before trusting `items`.
	public var stale: Bool
	public var loaded: Bool

	public static let empty = TranscriptState(items: [], sessionState: RemoteSessionState(status: .idle), pendingQuestion: nil, stale: false, loaded: false)
}

public enum TranscriptAction: Equatable, Sendable {
	case history(entries: [RemoteTranscriptEntry], state: RemoteSessionState)
	case message(RemoteMessageEvent)
	case tool(RemoteToolEvent)
	case state(RemoteSessionState)
	case question(RemoteQuestionRequest)
	case questionResolved(requestId: String)
	case localUser(text: String, at: Double, attachments: [TranscriptAttachment] = [])
	case resync
}

/// Pure reducer: history snapshot plus live events → chat view model (port of `transcript.ts`).
public enum TranscriptReducer {
	private static var localCounter = 0
	public static var now: () -> Double = WallClock.nowMs

	static func nextLocalId(_ prefix: String) -> String {
		localCounter += 1
		return "\(prefix)-\(String(Int64(now()), radix: 36))-\(localCounter)"
	}

	public static func reduce(_ state: TranscriptState, _ action: TranscriptAction) -> TranscriptState {
		var next = state
		switch action {
		case let .history(entries, sessionState):
			var items = keepingAttachments(entries.map(fromHistoryEntry), from: state.items)
			// A snapshot taken mid-turn ends in the partial reply; later deltas must
			// continue that bubble instead of opening a second one below it.
			if sessionState.status.isActive, case var .assistant(turn) = items.last {
				turn.streaming = true
				items[items.count - 1] = .assistant(turn)
			}
			return TranscriptState(
				items: items,
				sessionState: sessionState,
				pendingQuestion: sessionState.pendingQuestion,
				stale: false,
				loaded: true
			)
		case let .localUser(text, at, attachments):
			next.items.append(.user(id: nextLocalId("local-user"), text: text, at: at, attachments: attachments))
			return next
		case let .message(event):
			return applyMessage(state, event)
		case let .tool(event):
			return applyTool(state, event)
		case let .state(sessionState):
			let finished = !sessionState.status.isActive
			next.sessionState = sessionState
			// Most state events (completed, error, usage) leave the model out; keep what is known.
			next.sessionState.model = sessionState.model ?? state.sessionState.model
			next.sessionState.modelKey = sessionState.modelKey ?? state.sessionState.modelKey
			next.sessionState.thinkingLevel = sessionState.thinkingLevel ?? state.sessionState.thinkingLevel
			next.sessionState.contextPercent = sessionState.contextPercent ?? state.sessionState.contextPercent
			// Only an answer or the end of the turn retires a question: the turn keeps
			// reporting "running" (usage, retries) while it waits, and older desktops
			// send that without the question.
			let question = sessionState.pendingQuestion ?? (finished ? nil : state.pendingQuestion)
			next.pendingQuestion = question
			if let question {
				next.sessionState.status = .waitingInput
				next.sessionState.pendingQuestion = question
			}
			if finished {
				let streaming = if case let .assistant(turn) = state.items.last { turn.streaming } else { false }
				next.items = finalizeStreaming(state.items, sessionState)
				// The turn failed before it wrote anything: the error is all there is to show.
				if !streaming, sessionState.status == .error, let message = sessionState.error?.message, !message.isEmpty {
					next.items.append(.assistant(AssistantTurn(id: nextLocalId("error"), text: "", thinking: "", tools: [], streaming: false, at: now(), error: message)))
				}
			}
			return next
		case let .question(request):
			next.pendingQuestion = request
			next.sessionState.status = .waitingInput
			next.sessionState.pendingQuestion = request
			return next
		case let .questionResolved(requestId):
			guard state.pendingQuestion?.requestId == requestId else { return state }
			next.pendingQuestion = nil
			next.sessionState.status = .running
			next.sessionState.pendingQuestion = nil
			return next
		case .resync:
			var reset = TranscriptState.empty
			reset.sessionState = state.sessionState
			reset.stale = true
			return reset
		}
	}

	/// The desktop's history does not know what this phone attached; a refetch
	/// keeps those attachments on the matching user messages, in order.
	private static func keepingAttachments(_ items: [TranscriptItem], from previous: [TranscriptItem]) -> [TranscriptItem] {
		var known: [(text: String, attachments: [TranscriptAttachment])] = previous.compactMap {
			if case let .user(_, text, _, attachments) = $0, !attachments.isEmpty { return (text, attachments) }
			return nil
		}
		guard !known.isEmpty else { return items }
		return items.map { item in
			guard case let .user(id, text, at, attachments) = item, attachments.isEmpty,
			      let index = known.firstIndex(where: { $0.text == text })
			else { return item }
			return .user(id: id, text: text, at: at, attachments: known.remove(at: index).attachments)
		}
	}

	private static func fromHistoryEntry(_ entry: RemoteTranscriptEntry) -> TranscriptItem {
		switch entry {
		case let .user(id, text, at):
			return .user(id: id, text: text, at: at)
		case let .assistant(id, text, thinking, toolCalls, at, error):
			return .assistant(AssistantTurn(
				id: id,
				text: text,
				thinking: thinking ?? "",
				tools: toolCalls.map { call in
					ToolCard(toolCallId: call.toolCallId, toolName: call.toolName, status: call.isError ? .failed : .done, args: call.args, result: call.result, durationMs: call.durationMs)
				},
				streaming: false,
				at: at,
				error: error
			))
		case let .marker(id, text, at):
			return .marker(id: id, text: text, at: at)
		}
	}

	private static func applyMessage(_ state: TranscriptState, _ event: RemoteMessageEvent) -> TranscriptState {
		switch event {
		case let .user(text, at):
			// The optimistic bubble for our own prompt is replaced by the desktop's
			// authoritative copy, which keeps the attachments only this phone knows about.
			var next = state
			let (items, attachments) = dropMatchingLocalUser(state.items, text)
			next.items = items
			next.items.append(.user(id: nextLocalId("user"), text: text, at: at, attachments: attachments))
			return next
		case let .assistantDelta(text):
			return updateStreaming(state) { $0.text += text }
		case let .thinkingDelta(text):
			return updateStreaming(state) { $0.thinking += text }
		case .turnEnd:
			var next = state
			next.items = finalizeStreaming(state.items, state.sessionState)
			return next
		}
	}

	private static func applyTool(_ state: TranscriptState, _ event: RemoteToolEvent) -> TranscriptState {
		updateStreaming(state) { turn in
			let index = turn.tools.firstIndex { $0.toolCallId == event.toolCallId }
			let existing = index.map { turn.tools[$0] }
			let merged = ToolCard(
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				status: statusForPhase(event.phase, existing?.status),
				args: event.args ?? existing?.args,
				result: event.result ?? existing?.result,
				label: event.label ?? existing?.label,
				durationMs: event.durationMs ?? existing?.durationMs
			)
			if let index { turn.tools[index] = merged } else { turn.tools.append(merged) }
		}
	}

	private static func statusForPhase(_ phase: RemoteToolPhase, _ previous: ToolCardStatus?) -> ToolCardStatus {
		switch phase {
		case .generating: previous ?? .generating
		case .started, .updated, .phase: previous == .done || previous == .failed ? previous! : .running
		case .completed: .done
		case .failed: .failed
		}
	}

	private static func updateStreaming(_ state: TranscriptState, _ patch: (inout AssistantTurn) -> Void) -> TranscriptState {
		var next = state
		if case var .assistant(turn) = state.items.last, turn.streaming {
			patch(&turn)
			next.items[next.items.count - 1] = .assistant(turn)
			return next
		}
		var fresh = AssistantTurn(id: nextLocalId("assistant"), text: "", thinking: "", tools: [], streaming: true, at: now(), error: nil)
		patch(&fresh)
		next.items.append(.assistant(fresh))
		return next
	}

	private static func finalizeStreaming(_ items: [TranscriptItem], _ sessionState: RemoteSessionState) -> [TranscriptItem] {
		guard case var .assistant(turn) = items.last, turn.streaming else { return items }
		let failed = sessionState.status == .error
		turn.streaming = false
		turn.tools = turn.tools.map { tool in
			var tool = tool
			if tool.status == .running || tool.status == .generating { tool.status = failed ? .failed : .done }
			return tool
		}
		if failed, let message = sessionState.error?.message { turn.error = message }
		var output = Array(items.dropLast())
		if turn.text.isEmpty, turn.thinking.isEmpty, turn.tools.isEmpty, turn.error == nil { return output }
		output.append(.assistant(turn))
		return output
	}

	private static func dropMatchingLocalUser(_ items: [TranscriptItem], _ text: String) -> ([TranscriptItem], [TranscriptAttachment]) {
		for index in items.indices.reversed() {
			switch items[index] {
			case .assistant:
				continue
			case let .user(id, userText, _, attachments) where id.hasPrefix("local-user") && userText == text:
				var output = items
				output.remove(at: index)
				return (output, attachments)
			default:
				return (items, [])
			}
		}
		return (items, [])
	}
}
