import Foundation
import Testing
@testable import VettaKit

@Suite struct QuestionDraftTests {
	private let request = RemoteQuestionRequest(requestId: "q1", questions: [
		RemoteQuestionItem(question: "继续吗？", header: "确认", options: [RemoteQuestionOption(label: "继续", description: ""), RemoteQuestionOption(label: "先停下", description: "")], multiSelect: false),
		RemoteQuestionItem(question: "通知谁？", header: "通知", options: [RemoteQuestionOption(label: "产品", description: ""), RemoteQuestionOption(label: "测试", description: "")], multiSelect: true),
	])

	@Test func singleChoiceKeepsOneAnswerAndOtherReplacesIt() {
		var draft = QuestionDraft(request: request)
		draft.toggle("继续", at: 0)
		draft.toggle("先停下", at: 0)
		#expect(draft.answers(at: 0) == ["先停下"])
		draft.setOtherText("明天再说", at: 0)
		#expect(draft.isOtherActive(at: 0))
		#expect(draft.answers(at: 0) == ["明天再说"], "typing an answer replaces the picked option")
		draft.toggle("继续", at: 0)
		#expect(!draft.isOtherActive(at: 0))
		#expect(draft.answers(at: 0) == ["继续"], "picking an option turns Other off but keeps its text")
		#expect(draft.otherText(at: 0) == "明天再说")
	}

	@Test func multipleChoiceCombinesOptionsAndOther() {
		var draft = QuestionDraft(request: request)
		draft.toggle("产品", at: 1)
		draft.toggle("测试", at: 1)
		draft.toggle("产品", at: 1)
		draft.toggleOther(at: 1)
		#expect(draft.answers(at: 1) == ["测试"], "Other counts only once it has text")
		draft.setOtherText("  设计 ", at: 1)
		#expect(draft.answers(at: 1) == ["测试", "设计"])
	}

	@Test func stepsThroughQuestionsAndSubmitsOneEntryEach() {
		var draft = QuestionDraft(request: request)
		#expect(!draft.isLast && draft.answeredCount == 0)
		draft.toggle("继续", at: 0)
		draft.next()
		#expect(draft.current == 1 && draft.isLast)
		#expect(!draft.allAnswered)
		draft.toggle("测试", at: 1)
		draft.next()
		#expect(draft.current == 1, "there is nothing after the last question")
		#expect(draft.allAnswered)
		#expect(draft.result == [
			RemoteQuestionAnswer(question: "继续吗？", answers: ["继续"]),
			RemoteQuestionAnswer(question: "通知谁？", answers: ["测试"]),
		])
	}
}
