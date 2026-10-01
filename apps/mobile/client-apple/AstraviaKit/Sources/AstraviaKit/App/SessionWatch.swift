import Foundation

/// Something a session did that is worth telling a user who is not looking.
public struct SessionAlert: Equatable, Sendable {
	public enum Kind: String, Equatable, Sendable {
		/// The desktop asked a question and waits for an answer.
		case needsInput
		/// A turn ran to its end.
		case finished
		case failed
	}

	public var sessionId: String
	public var title: String
	public var kind: Kind
	/// The question being asked, when `needsInput` and it is known.
	public var detail: String?
}

/// What the Live Activity shows: how many sessions are busy and which one leads.
/// `nonisolated` because ActivityKit encodes it off the main actor.
nonisolated public struct LiveDigest: Codable, Hashable, Sendable {
	nonisolated public struct Headline: Codable, Hashable, Sendable {
		public var sessionId: String
		public var title: String
		public var waiting: Bool
		/// When the session became busy, in ms since 1970; the activity counts up from it.
		public var since: Double
		/// The question it waits on, when it can be answered with one tap.
		public var question: LiveQuestion?
		/// The choice just tapped on the activity, while it is on its way to the desktop.
		public var answering: String?

		public init(sessionId: String, title: String, waiting: Bool, since: Double, question: LiveQuestion? = nil, answering: String? = nil) {
			self.sessionId = sessionId
			self.title = title
			self.waiting = waiting
			self.since = since
			self.question = question
			self.answering = answering
		}
	}

	public var waiting: Int
	public var running: Int
	/// Nil once nothing is busy: the activity then shows that everything is done.
	public var headline: Headline?

	public init(waiting: Int, running: Int, headline: Headline?) {
		self.waiting = waiting
		self.running = running
		self.headline = headline
	}

	public var busy: Bool { headline != nil }

	public static let idle = LiveDigest(waiting: 0, running: 0, headline: nil)
}

/// Where session news reaches the user outside the app: notifications, the icon
/// badge and the Live Activity.
public protocol SessionSignals: AnyObject {
	/// A session changed while the app was not in front.
	func alert(_ alert: SessionAlert)
	/// Takes back what was said about `sessionId`: it was opened, or its question closed.
	func withdraw(_ sessionId: String)
	/// The busy sessions as they are now; `active` is whether the app is in front.
	func show(_ digest: LiveDigest, active: Bool)
}

/// A question the Live Activity offers as buttons: one question, one choice
/// among a few options. Anything else is answered in the app.
nonisolated public struct LiveQuestion: Codable, Hashable, Sendable {
	/// As many buttons as fit side by side on the Lock Screen.
	public static let maxOptions = 3
	/// ActivityKit caps the whole state at 4 KB, so long texts are cut.
	static let maxQuestion = 160
	static let maxOption = 40

	public var requestId: String
	/// The question as the desktop asked it, which the answer must name.
	public var question: String
	/// What the activity shows, cut to fit.
	public var text: String
	public var options: [String]

	public init?(_ request: RemoteQuestionRequest) {
		guard request.questions.count == 1, let item = request.questions.first, !item.multiSelect,
		      (1 ... Self.maxOptions).contains(item.options.count),
		      item.options.allSatisfy({ $0.label.count <= Self.maxOption })
		else { return nil }
		requestId = request.requestId
		question = item.question
		text = String(item.question.prefix(Self.maxQuestion))
		options = item.options.map(\.label)
	}
}

/// Follows session statuses between two looks at the list: which changes deserve
/// a notification, and what the Live Activity should show.
public struct SessionWatch {
	/// When each busy session was first seen busy.
	private var busySince: [String: Double] = [:]

	public init() {}

	/// The alerts for sessions whose status changed from `old` to `new`. Sessions
	/// seen for the first time raise none: a list restored from the cache or a
	/// first fetch would otherwise announce everything at once.
	public mutating func update(from old: [RemoteSessionSummary], to new: [RemoteSessionSummary], now: Double = WallClock.nowMs(), question: (String) -> String? = { _ in nil }) -> [SessionAlert] {
		let before = Dictionary(old.map { ($0.id, $0.status) }, uniquingKeysWith: { first, _ in first })
		var alerts: [SessionAlert] = []
		var nextSince: [String: Double] = [:]
		for session in new {
			if session.status.isActive {
				nextSince[session.id] = busySince[session.id] ?? (before[session.id]?.isActive == true ? session.updatedAt : now)
			}
			guard let previous = before[session.id], previous != session.status,
			      let kind = Self.alert(from: previous, to: session.status)
			else { continue }
			alerts.append(SessionAlert(
				sessionId: session.id,
				title: Self.title(session),
				kind: kind,
				detail: kind == .needsInput ? question(session.id) : nil
			))
		}
		busySince = nextSince
		return alerts
	}

	/// `question` gives a waiting session's open question, when it is known.
	public func digest(_ sessions: [RemoteSessionSummary], question: (String) -> RemoteQuestionRequest? = { _ in nil }) -> LiveDigest {
		let waiting = sessions.filter { $0.status == .waitingInput }
		let running = sessions.filter { $0.status.isActive && $0.status != .waitingInput }
		let recent: (RemoteSessionSummary, RemoteSessionSummary) -> Bool = { $0.updatedAt < $1.updatedAt }
		let lead = waiting.max(by: recent) ?? running.max(by: recent)
		return LiveDigest(
			waiting: waiting.count,
			running: running.count,
			headline: lead.map { session in
				LiveDigest.Headline(
					sessionId: session.id,
					title: Self.title(session),
					waiting: session.status == .waitingInput,
					since: busySince[session.id] ?? session.updatedAt,
					question: session.status == .waitingInput ? question(session.id).flatMap(LiveQuestion.init) : nil
				)
			}
		)
	}

	private static func alert(from previous: RemoteSessionStatus, to next: RemoteSessionStatus) -> SessionAlert.Kind? {
		switch next {
		case .waitingInput: return .needsInput
		case .error: return .failed
		case .completed: return previous.isActive ? .finished : nil
		// A turn that ended between two list refreshes reads as idle; a question
		// withdrawn without a turn running goes back to idle too, and is not news.
		case .idle: return previous.isActive && previous != .waitingInput ? .finished : nil
		// Stopped on purpose, here or on the desktop.
		case .aborted, .running, .thinking: return nil
		}
	}

	private static func title(_ session: RemoteSessionSummary) -> String {
		let title = session.title.trimmingCharacters(in: .whitespacesAndNewlines)
		if !title.isEmpty { return title }
		let preview = session.preview?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		return preview.isEmpty ? L10n.Home.untitled : String(preview.prefix(60))
	}
}
