import Foundation

/// One project as the home cards and All Projects show it, worked out from the
/// phone's session list: the desktop's project list carries no activity time.
public struct ProjectDigest: Identifiable, Equatable, Sendable {
	public var cwd: String
	public var name: String
	public var sessionCount: Int
	/// The newest session's `updatedAt`; 0 for a project with no session on the phone.
	public var updatedAt: Double
	/// The sessions a card lists: those waiting on the user first, then newest first.
	public var recent: [RemoteSessionSummary]

	public var id: String { cwd }

	/// Every project, most recently active first. Projects the desktop lists but
	/// the phone has no session for come last, with the desktop's count.
	/// The conversation bucket is not a project; while it is unknown nothing is
	/// listed, so it never shows up as one.
	public static func all(
		_ sessions: [RemoteSessionSummary],
		projects: [RemoteProjectSummary] = [],
		conversationCwd: String?,
		recentLimit: Int = 2
	) -> [ProjectDigest] {
		guard let conversationCwd else { return [] }
		var grouped: [String: [RemoteSessionSummary]] = [:]
		for session in sessions where session.projectCwd != conversationCwd {
			grouped[session.projectCwd, default: []].append(session)
		}
		var digests = grouped.map { cwd, sessions in digest(cwd, sessions, recentLimit: recentLimit) }
		for project in projects where !project.isConversation && grouped[project.cwd] == nil {
			digests.append(ProjectDigest(cwd: project.cwd, name: project.name, sessionCount: Int(project.sessionCount), updatedAt: 0, recent: []))
		}
		return digests.sorted { a, b in
			if a.updatedAt != b.updatedAt { return a.updatedAt > b.updatedAt }
			return a.name.localizedStandardCompare(b.name) == .orderedAscending
		}
	}

	/// The projects on the home cards: the `limit` most recently active that have sessions.
	public static func recent(_ sessions: [RemoteSessionSummary], conversationCwd: String?, limit: Int = 3) -> [ProjectDigest] {
		Array(all(sessions, conversationCwd: conversationCwd).prefix(limit))
	}

	/// The desktop's project-less chats as one more card, ahead of the projects;
	/// `nil` until the bucket is known or while it holds no session.
	public static func conversations(_ sessions: [RemoteSessionSummary], conversationCwd: String?, recentLimit: Int = 2) -> ProjectDigest? {
		guard let conversationCwd else { return nil }
		let chats = sessions.filter { $0.projectCwd == conversationCwd }
		return chats.isEmpty ? nil : digest(conversationCwd, chats, recentLimit: recentLimit)
	}

	private static func digest(_ cwd: String, _ sessions: [RemoteSessionSummary], recentLimit: Int) -> ProjectDigest {
		ProjectDigest(
			cwd: cwd,
			name: sessions[0].projectName,
			sessionCount: sessions.count,
			updatedAt: sessions.map(\.updatedAt).max() ?? 0,
			recent: Array(cardOrder(sessions).prefix(recentLimit))
		)
	}

	/// Pins are left out: an old pinned session would hold a card's slot forever.
	static func cardOrder(_ sessions: [RemoteSessionSummary]) -> [RemoteSessionSummary] {
		sessions.sorted { a, b in
			let aWaiting = a.status == .waitingInput
			let bWaiting = b.status == .waitingInput
			if aWaiting != bWaiting { return aWaiting }
			return a.updatedAt > b.updatedAt
		}
	}
}

/// The home search, run on the phone over what the session list already holds.
public enum HomeSearch {
	/// Title, preview and project name, ignoring case and width; a blank query matches everything.
	public static func matches(_ session: RemoteSessionSummary, _ query: String) -> Bool {
		let terms = self.terms(query)
		guard !terms.isEmpty else { return true }
		let haystack = [session.title, session.preview ?? "", session.projectName]
		return terms.allSatisfy { term in haystack.contains { contains($0, term) } }
	}

	public static func matches(_ project: ProjectDigest, _ query: String) -> Bool {
		let terms = self.terms(query)
		return !terms.isEmpty && terms.allSatisfy { contains(project.name, $0) }
	}

	private static func terms(_ query: String) -> [Substring] {
		query.split(whereSeparator: \.isWhitespace)
	}

	private static func contains(_ text: String, _ term: Substring) -> Bool {
		text.range(of: term, options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive]) != nil
	}
}
