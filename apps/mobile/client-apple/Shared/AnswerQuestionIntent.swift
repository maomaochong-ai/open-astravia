import AppIntents

/// A choice tapped on the Live Activity. iOS runs it in the app, waking it in the
/// background when needed; the widget extension only draws the button.
struct AnswerQuestionIntent: LiveActivityIntent {
	static let title: LocalizedStringResource = "Answer"
	static let isDiscoverable = false
	/// Approving an agent's next step from a locked phone would let whoever holds it do so.
	static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

	@Parameter(title: "Session") var sessionId: String
	@Parameter(title: "Request") var requestId: String
	@Parameter(title: "Question") var question: String
	@Parameter(title: "Choice") var choice: String

	init() {}

	init(sessionId: String, requestId: String, question: String, choice: String) {
		self.sessionId = sessionId
		self.requestId = requestId
		self.question = question
		self.choice = choice
	}

	func perform() async throws -> some IntentResult {
		if let handler = await AnswerQuestionHandler.run {
			await handler(sessionId, requestId, question, choice)
		}
		return .result()
	}
}

/// What `AnswerQuestionIntent` does, set by the app at launch; the extension never performs it.
@MainActor
enum AnswerQuestionHandler {
	static var run: (@MainActor @Sendable (_ sessionId: String, _ requestId: String, _ question: String, _ choice: String) async -> Void)?
}
