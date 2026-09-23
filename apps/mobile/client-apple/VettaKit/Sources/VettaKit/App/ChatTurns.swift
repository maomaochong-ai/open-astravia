import Foundation

/// One step of an agent's work, shown as a row inside a folded work group.
public enum WorkStep: Equatable, Identifiable, Sendable {
	case thinking(id: String, text: String)
	case tool(ToolCard)

	public var id: String {
		switch self {
		case let .thinking(id, _): id
		case let .tool(card): card.id
		}
	}

	public var pending: Bool {
		if case let .tool(card) = self { return card.status == .running || card.status == .generating }
		return false
	}
}

/// A piece of a turn in display order: thinking and tools fold together until
/// the agent writes text, which closes the group (as the desktop's work stages do).
public enum TurnSegment: Equatable, Identifiable, Sendable {
	case work(id: String, steps: [WorkStep])
	case text(id: String, text: String)
	case error(id: String, message: String)

	public var id: String {
		switch self {
		case let .work(id, _), let .text(id, _), let .error(id, _): id
		}
	}
}

/// Everything the agent did between two user messages, merged into one turn.
public struct AgentTurn: Equatable, Identifiable, Sendable {
	public var id: String
	public var segments: [TurnSegment]
	public var streaming: Bool
	public var startedAt: Double?

	/// The closing answer, for the copy button: the text after the last work group.
	public var conclusion: String {
		var texts: [String] = []
		for segment in segments.reversed() {
			switch segment {
			case let .text(_, text): texts.insert(text, at: 0)
			case .error: continue
			case .work: return texts.joined(separator: "\n\n")
			}
		}
		return texts.joined(separator: "\n\n")
	}

	/// What the agent is doing right now, for the live group title.
	public var activity: WorkStep? {
		guard streaming, case let .work(_, steps) = segments.last else { return nil }
		return steps.last(where: \.pending) ?? steps.last
	}
}

public enum ChatBlock: Equatable, Identifiable, Sendable {
	case user(id: String, text: String, at: Double?, attachments: [TranscriptAttachment])
	case marker(id: String, text: String, at: Double?)
	case turn(AgentTurn)

	public var id: String {
		switch self {
		case let .user(id, _, _, _), let .marker(id, _, _): id
		case let .turn(turn): turn.id
		}
	}
}

public enum ChatTurns {
	/// Merges consecutive assistant items into one turn. A user message or a
	/// marker (e.g. compaction) ends the turn; errors stay inside it.
	public static func build(_ items: [TranscriptItem]) -> [ChatBlock] {
		var blocks: [ChatBlock] = []
		for item in items {
			switch item {
			case let .user(id, text, at, attachments):
				blocks.append(.user(id: id, text: text, at: at, attachments: attachments))
			case let .marker(id, text, at):
				blocks.append(.marker(id: id, text: text, at: at))
			case let .assistant(reply):
				var turn: AgentTurn
				if case let .turn(existing) = blocks.last {
					turn = existing
					blocks.removeLast()
				} else {
					turn = AgentTurn(id: reply.id, segments: [], streaming: false, startedAt: reply.at)
				}
				append(reply, to: &turn)
				turn.streaming = reply.streaming
				blocks.append(.turn(turn))
			}
		}
		return blocks
	}

	private static func append(_ reply: AssistantTurn, to turn: inout AgentTurn) {
		var steps: [WorkStep] = []
		if !reply.thinking.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
			steps.append(.thinking(id: "\(reply.id)-thinking", text: reply.thinking))
		}
		steps += reply.tools.map(WorkStep.tool)
		if !steps.isEmpty {
			if case let .work(id, previous) = turn.segments.last {
				turn.segments[turn.segments.count - 1] = .work(id: id, steps: previous + steps)
			} else {
				turn.segments.append(.work(id: "\(reply.id)-work", steps: steps))
			}
		}
		if !reply.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
			turn.segments.append(.text(id: "\(reply.id)-text", text: reply.text))
		}
		if let error = reply.error {
			turn.segments.append(.error(id: "\(reply.id)-error", message: error))
		}
	}
}
