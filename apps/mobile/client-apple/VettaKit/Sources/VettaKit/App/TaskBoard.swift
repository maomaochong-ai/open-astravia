import Foundation

/// One card on the task board: a project, or the desktop's conversations, with the
/// sessions worth a look. While any of them waits or runs the card lists those;
/// otherwise its newest few.
public struct TaskBoardCard: Identifiable, Equatable, Sendable {
	public var cwd: String
	public var name: String
	public var isConversation: Bool
	/// Waiting and running sessions first, most recent first within each; capped.
	public var sessions: [RemoteSessionSummary]
	/// Waiting or running sessions left off the card by the cap.
	public var hidden: Int
	public var waiting: Int
	public var running: Int
	/// The newest session's `updatedAt`.
	public var updatedAt: Double

	public var id: String { cwd }

	public var active: Bool { waiting + running > 0 }

	/// What orders the board: waiting 100, running 10, the conversations 5 and a project
	/// all done 1, added up, so a card that both waits and runs outranks one that only waits.
	public var score: Int {
		(waiting > 0 ? 100 : 0) + (running > 0 ? 10 : 0) + (isConversation ? 5 : 0) + (active || isConversation ? 0 : 1)
	}
}

public enum TaskBoard {
	/// Projects with nothing waiting or running beyond these are left to Home's list.
	public static let doneProjectLimit = 6
	/// Sessions an all-done card lists.
	public static let recentLimit = 3
	/// Waiting or running sessions a card lists before it points to the rest.
	public static let activeLimit = 5

	/// Every card, highest score first and the most recently active first within a score.
	/// Nothing until the conversation bucket is known, so it never passes for a project.
	public static func cards(_ sessions: [RemoteSessionSummary], conversationCwd: String?) -> [TaskBoardCard] {
		guard let conversationCwd else { return [] }
		var grouped: [String: [RemoteSessionSummary]] = [:]
		for session in sessions {
			grouped[session.projectCwd, default: []].append(session)
		}
		let all = grouped.map { cwd, sessions in card(cwd: cwd, sessions: sessions, isConversation: cwd == conversationCwd) }
			.sorted(by: ranks)
		var doneProjects = 0
		return all.filter { card in
			guard !card.active, !card.isConversation else { return true }
			doneProjects += 1
			return doneProjects <= doneProjectLimit
		}
	}

	/// Splits cards into columns for a waterfall, each card going to the shortest column
	/// so far, measured in rows; reading left to right, top to bottom keeps the ranking.
	public static func columns(_ cards: [TaskBoardCard], count: Int) -> [[TaskBoardCard]] {
		guard count > 0 else { return [] }
		var columns = Array(repeating: [TaskBoardCard](), count: count)
		var heights = Array(repeating: 0, count: count)
		for card in cards {
			let shortest = heights.indices.min { heights[$0] < heights[$1] } ?? 0
			columns[shortest].append(card)
			// The name and the card's padding weigh about two rows.
			heights[shortest] += card.sessions.count + (card.hidden > 0 ? 1 : 0) + 2
		}
		return columns
	}

	private static func card(cwd: String, sessions: [RemoteSessionSummary], isConversation: Bool) -> TaskBoardCard {
		let newest = sessions.sorted { $0.updatedAt > $1.updatedAt }
		let waiting = newest.filter { SessionStatusGroup($0.status) == .waiting }
		let running = newest.filter { SessionStatusGroup($0.status) == .processing }
		let active = waiting + running
		return TaskBoardCard(
			cwd: cwd,
			name: sessions[0].projectName,
			isConversation: isConversation,
			sessions: active.isEmpty ? Array(newest.prefix(recentLimit)) : Array(active.prefix(activeLimit)),
			hidden: max(active.count - activeLimit, 0),
			waiting: waiting.count,
			running: running.count,
			updatedAt: newest[0].updatedAt
		)
	}

	private static func ranks(_ a: TaskBoardCard, _ b: TaskBoardCard) -> Bool {
		if a.score != b.score { return a.score > b.score }
		if a.updatedAt != b.updatedAt { return a.updatedAt > b.updatedAt }
		return a.name.localizedStandardCompare(b.name) == .orderedAscending
	}
}
