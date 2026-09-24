import Foundation

/// The composer's press on an empty field: a quick tap starts typing, holding
/// starts dictation, sliding up while listening arms cancel, and letting go
/// either inserts what was heard or throws it away.
public struct HoldToTalk: Equatable, Sendable {
	/// Short enough that talking feels immediate; a slow tap that outlasts it is caught by `quickRelease`.
	public static let holdDelay: TimeInterval = 0.1
	/// Letting go this soon after listening started was a slow tap, not speech: type instead.
	public static let quickRelease: TimeInterval = 0.2
	/// Moving further than this before the hold registers is a scroll or swipe, not a press.
	public static let slop: Double = 12
	/// Sliding up this far while listening arms cancel.
	public static let cancelDistance: Double = 60

	public enum Phase: Equatable, Sendable {
		case idle
		case pressing(since: TimeInterval)
		case listening(cancelArmed: Bool)
		/// Moved away before the hold registered; ignore the rest of this touch.
		case abandoned
	}

	public enum Action: Equatable, Sendable {
		case none
		/// A plain tap: start typing.
		case focus
		case startListening
		case cancelArmed(Bool)
		/// Released while listening: insert the transcript unless cancel was armed.
		case finish(insert: Bool)
		/// Released right after listening started: drop the dictation and start typing.
		case cancelAndFocus
	}

	public private(set) var phase: Phase = .idle
	private var listeningSince: TimeInterval = 0

	public init() {}

	public mutating func began(at time: TimeInterval) -> Action {
		phase = .pressing(since: time)
		return .none
	}

	/// Called while the finger is down, including by a timer when it holds still.
	public mutating func moved(dx: Double, dy: Double, at time: TimeInterval) -> Action {
		switch phase {
		case let .pressing(since):
			if (dx * dx + dy * dy).squareRoot() > Self.slop {
				phase = .abandoned
				return .none
			}
			guard time - since >= Self.holdDelay else { return .none }
			phase = .listening(cancelArmed: false)
			listeningSince = time
			return .startListening
		case let .listening(armed):
			let nowArmed = dy < -Self.cancelDistance
			guard nowArmed != armed else { return .none }
			phase = .listening(cancelArmed: nowArmed)
			return .cancelArmed(nowArmed)
		case .idle, .abandoned:
			return .none
		}
	}

	public mutating func ended(at time: TimeInterval) -> Action {
		defer { phase = .idle }
		switch phase {
		case .pressing:
			// Never reached listening, so it was a tap, even if it outlasted the hold
			// before the timer got round to noticing.
			return .focus
		case let .listening(armed):
			if !armed, time - listeningSince < Self.quickRelease { return .cancelAndFocus }
			return .finish(insert: !armed)
		case .idle, .abandoned:
			return .none
		}
	}
}

extension PromptDraft {
	/// Adds dictated words after what is already typed, with a space only where
	/// Latin text would otherwise run together (Chinese needs none).
	public mutating func insertDictation(_ dictated: String) {
		let words = dictated.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !words.isEmpty else { return }
		guard let last = text.unicodeScalars.last, let first = words.unicodeScalars.first else {
			text = words
			return
		}
		let afterLatin = last.isASCII && !CharacterSet.whitespacesAndNewlines.contains(last)
		let startsWord = first.isASCII && CharacterSet.alphanumerics.contains(first)
		text += afterLatin && startsWord ? " " + words : words
	}
}
