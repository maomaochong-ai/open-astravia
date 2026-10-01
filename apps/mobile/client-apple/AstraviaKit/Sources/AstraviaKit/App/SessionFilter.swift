import Foundation

/// The status groups the work list filters by. Sessions waiting on the user's
/// answer are their own group, apart from those still running on their own.
public enum SessionStatusGroup: CaseIterable, Sendable {
	case waiting, processing, done

	public init(_ status: RemoteSessionStatus) {
		switch status {
		case .waitingInput: self = .waiting
		case .running, .thinking: self = .processing
		case .idle, .completed, .error, .aborted: self = .done
		}
	}
}

public enum SessionKind: Sendable {
	case conversation, project
}

/// What the project picker chooses: every session, the desktop's conversations, or one project.
public enum ProjectScope: Hashable, Sendable {
	case all, conversations
	case project(String)
}

/// What the work list shows: a status group, a kind, and within projects one project.
public struct SessionFilter: Equatable, Sendable {
	public var status: SessionStatusGroup?
	public var kind: SessionKind? {
		didSet { if kind != .project { projectCwd = nil } }
	}

	/// Only meaningful while `kind` is `.project`.
	public var projectCwd: String?

	public init(status: SessionStatusGroup? = nil, kind: SessionKind? = nil, projectCwd: String? = nil) {
		self.status = status
		self.kind = kind
		self.projectCwd = kind == .project ? projectCwd : nil
	}

	/// The kind and project as one choice, as the project picker sets them.
	public var scope: ProjectScope {
		get {
			switch kind {
			case nil: .all
			case .conversation: .conversations
			case .project: projectCwd.map(ProjectScope.project) ?? .all
			}
		}
		set {
			switch newValue {
			case .all: kind = nil
			case .conversations: kind = .conversation
			case let .project(cwd):
				kind = .project
				projectCwd = cwd
			}
		}
	}

	/// Anything narrowed down; the default state shows every session.
	public var isActive: Bool { self != SessionFilter() }

	/// `conversationCwd` tells conversations from projects; while it is unknown
	/// every session counts as a project.
	public func matches(_ session: RemoteSessionSummary, conversationCwd: String?) -> Bool {
		if let status, SessionStatusGroup(session.status) != status { return false }
		switch kind {
		case nil: return true
		case .conversation: return session.projectCwd == conversationCwd
		case .project:
			guard session.projectCwd != conversationCwd else { return false }
			return projectCwd == nil || session.projectCwd == projectCwd
		}
	}

	/// Filtered and ordered for display: pinned sessions first (newest pin on top),
	/// then those waiting on the user, then newest first.
	public func apply(_ sessions: [RemoteSessionSummary], conversationCwd: String?) -> [RemoteSessionSummary] {
		SessionFilter.ordered(sessions.filter { matches($0, conversationCwd: conversationCwd) })
	}

	public static func ordered(_ sessions: [RemoteSessionSummary]) -> [RemoteSessionSummary] {
		sessions.sorted { a, b in
			if a.pinnedAt != b.pinnedAt {
				guard let aPin = a.pinnedAt else { return false }
				guard let bPin = b.pinnedAt else { return true }
				return aPin > bPin
			}
			let aWaiting = a.status == .waitingInput
			let bWaiting = b.status == .waitingInput
			if aWaiting != bWaiting { return aWaiting }
			return a.updatedAt > b.updatedAt
		}
	}
}
