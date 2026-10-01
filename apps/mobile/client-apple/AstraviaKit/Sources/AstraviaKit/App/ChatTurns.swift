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
	/// `count` > 1 when the same failure repeated, e.g. over automatic retries.
	case error(id: String, message: String, count: Int)

	public var id: String {
		switch self {
		case let .work(id, _), let .text(id, _), let .error(id, _, _): id
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
	/// marker (e.g. compaction) ends the turn; errors stay inside it. `waiting`
	/// means the session is working: a turn with nothing to show yet still
	/// appears, so a sent message never sits there without feedback.
	public static func build(_ items: [TranscriptItem], waiting: Bool = false) -> [ChatBlock] {
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
		if waiting {
			if case var .turn(turn) = blocks.last {
				turn.streaming = true
				blocks[blocks.count - 1] = .turn(turn)
			} else {
				blocks.append(.turn(AgentTurn(id: "pending-turn", segments: [], streaming: true, startedAt: nil)))
			}
		}
		return blocks
	}

	/// Where the latest exchange starts: the last user message, which a send
	/// scrolls to the top of the chat. Nil before anything was sent.
	public static func latestExchange(_ blocks: [ChatBlock]) -> Int? {
		blocks.lastIndex { if case .user = $0 { true } else { false } }
	}

	private static func append(_ reply: AssistantTurn, to turn: inout AgentTurn) {
		var steps: [WorkStep] = []
		if !reply.thinking.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
			steps.append(.thinking(id: "\(reply.id)-thinking", text: reply.thinking))
		}
		steps += reply.tools.map(WorkStep.tool)
		let text = reply.text.trimmingCharacters(in: .whitespacesAndNewlines)
		if !steps.isEmpty || !text.isEmpty {
			// New output means the attempts that failed before it were retried
			// successfully; like the desktop, those failures are dropped.
			while case .error = turn.segments.last { turn.segments.removeLast() }
		}
		if !steps.isEmpty {
			if case let .work(id, previous) = turn.segments.last {
				turn.segments[turn.segments.count - 1] = .work(id: id, steps: previous + steps)
			} else {
				turn.segments.append(.work(id: "\(reply.id)-work", steps: steps))
			}
		}
		if !text.isEmpty {
			turn.segments.append(.text(id: "\(reply.id)-text", text: reply.text))
		}
		if let error = reply.error {
			if case let .error(id, message, count) = turn.segments.last, message == error {
				turn.segments[turn.segments.count - 1] = .error(id: id, message: message, count: count + 1)
			} else {
				turn.segments.append(.error(id: "\(reply.id)-error", message: error, count: 1))
			}
		}
	}
}

/// One row of the chat's lazy list. A turn is split into its header, each of
/// its segments and its copy button: as a single row, a turn of many steps was
/// built all at once when its chat opened, which froze the screen for seconds.
public enum ChatLine: Equatable, Identifiable, Sendable {
	case timestamp(Double)
	case user(id: String, text: String, attachments: [TranscriptAttachment])
	case marker(id: String, text: String)
	/// `empty` while the turn has nothing to show yet; `ends` when nothing of the turn follows.
	case head(id: String, startedAt: Double?, streaming: Bool, empty: Bool, ends: Bool)
	/// `live` for the last piece of a streaming turn, which `activity` then names.
	case piece(TurnSegment, live: Bool, ends: Bool, activity: WorkStep?)
	/// The copy button under a finished turn.
	case foot(id: String, conclusion: String)

	public var id: String {
		switch self {
		case .timestamp: "ts"
		case let .user(id, _, _), let .marker(id, _): id
		case let .head(id, _, _, _, _): "\(id)-head"
		case let .piece(segment, _, _, _): segment.id
		case let .foot(id, _): "\(id)-foot"
		}
	}
}

public enum ChatLines {
	/// The chat's rows, and where the latest exchange starts among them (past
	/// the end before anything was sent).
	public static func build(_ items: [TranscriptItem], waiting: Bool = false) -> (lines: [ChatLine], latest: Int) {
		var lines: [ChatLine] = []
		if let first = items.first?.at { lines.append(.timestamp(first)) }
		var latest: Int?
		for block in ChatTurns.build(items, waiting: waiting) {
			switch block {
			case let .user(id, text, _, attachments):
				latest = lines.count
				lines.append(.user(id: id, text: text, attachments: attachments))
			case let .marker(id, text, _):
				lines.append(.marker(id: id, text: text))
			case let .turn(turn):
				let copy = !turn.streaming && !turn.conclusion.isEmpty
				lines.append(.head(id: turn.id, startedAt: turn.startedAt, streaming: turn.streaming, empty: turn.segments.isEmpty, ends: turn.segments.isEmpty && !copy))
				for (index, segment) in turn.segments.enumerated() {
					let last = index == turn.segments.count - 1
					let live = turn.streaming && last
					lines.append(.piece(segment, live: live, ends: last && !copy, activity: live ? turn.activity : nil))
				}
				if copy { lines.append(.foot(id: turn.id, conclusion: turn.conclusion)) }
			}
		}
		return (lines, latest ?? lines.endIndex)
	}
}

/// When the chat offers a jump to its end.
public enum ChatScroll {
	/// Once more than one and a half screens are left below: past that, scrolling
	/// there by hand takes several flicks. Nonisolated: it runs on SwiftUI's render thread.
	public nonisolated static func offersJump(below: Double, viewport: Double) -> Bool {
		viewport > 0 && below > viewport * 1.5
	}
}
