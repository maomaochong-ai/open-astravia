import Foundation

/// The answers being given to one AskUserQuestion request, with the desktop
/// panel's rules: single choice or several, plus a free-text "Other".
public struct QuestionDraft: Equatable, Sendable {
	public let request: RemoteQuestionRequest
	/// The question on screen when there are several.
	public var current = 0
	private var selected: [Int: [String]] = [:]
	private var otherActive: [Int: Bool] = [:]
	private var otherTexts: [Int: String] = [:]

	public init(request: RemoteQuestionRequest) {
		self.request = request
	}

	public var count: Int { request.questions.count }
	public var isLast: Bool { current >= count - 1 }
	public var answeredCount: Int { request.questions.indices.count { isAnswered($0) } }
	public var allAnswered: Bool { answeredCount == count }

	public func isSelected(_ label: String, at index: Int) -> Bool {
		(selected[index] ?? []).contains(label)
	}

	public func isOtherActive(at index: Int) -> Bool { otherActive[index] == true }

	public func otherText(at index: Int) -> String { otherTexts[index] ?? "" }

	/// The chosen labels, then the Other text when it is on and not blank.
	public func answers(at index: Int) -> [String] {
		var answers = selected[index] ?? []
		let other = otherText(at: index).trimmingCharacters(in: .whitespacesAndNewlines)
		if isOtherActive(at: index), !other.isEmpty { answers.append(other) }
		return answers
	}

	public func isAnswered(_ index: Int) -> Bool { !answers(at: index).isEmpty }

	public mutating func toggle(_ label: String, at index: Int) {
		guard request.questions.indices.contains(index) else { return }
		if request.questions[index].multiSelect {
			var current = selected[index] ?? []
			if let position = current.firstIndex(of: label) { current.remove(at: position) } else { current.append(label) }
			selected[index] = current
		} else {
			// One answer only: picking an option turns Other off.
			selected[index] = [label]
			otherActive[index] = false
		}
	}

	public mutating func toggleOther(at index: Int) {
		setOther(active: !isOtherActive(at: index), at: index)
	}

	/// Typing an answer switches Other on.
	public mutating func setOtherText(_ text: String, at index: Int) {
		otherTexts[index] = text
		if !text.isEmpty, !isOtherActive(at: index) { setOther(active: true, at: index) }
	}

	private mutating func setOther(active: Bool, at index: Int) {
		guard request.questions.indices.contains(index) else { return }
		otherActive[index] = active
		if active, !request.questions[index].multiSelect { selected[index] = [] }
	}

	public mutating func next() {
		if !isLast { current += 1 }
	}

	/// One answer entry per question, in order, as `session.respond` takes them.
	public var result: [RemoteQuestionAnswer] {
		request.questions.indices.map { RemoteQuestionAnswer(question: request.questions[$0].question, answers: answers(at: $0)) }
	}
}
