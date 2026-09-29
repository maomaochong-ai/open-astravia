import Foundation
import Testing
@testable import VettaKit

@Suite struct ChatLinesTests {
	private func reply(_ id: String, text: String = "", tools: [ToolCard] = [], streaming: Bool = false) -> TranscriptItem {
		.assistant(AssistantTurn(id: id, text: text, thinking: "", tools: tools, streaming: streaming, at: 1))
	}

	private func tool(_ id: String) -> ToolCard {
		ToolCard(toolCallId: id, toolName: "bash", status: .done)
	}

	/// A turn of many steps was one row of the lazy list, so opening its chat built
	/// every step's text at once and froze the phone.
	@Test func everyPieceOfALongTurnIsARowOfItsOwn() {
		let steps = (0 ..< 40).map { reply("a\($0)", text: "第 \($0) 步", tools: [tool("t\($0)")]) }
		let chat = ChatLines.build([.user(id: "u1", text: "开始", at: 1)] + steps)
		#expect(chat.lines.count == 84, "timestamp, message, header, a work group and a text per step, copy")
		#expect(chat.lines.map(\.id).count == Set(chat.lines.map(\.id)).count)
		#expect(chat.lines[2].id == "a0-head")
		#expect(chat.lines.last?.id == "a0-foot")
	}

	@Test func theLatestExchangeStartsAtTheLastMessage() {
		let chat = ChatLines.build([
			.user(id: "u1", text: "查一下", at: 1),
			reply("a1", text: "查到了"),
			.user(id: "u2", text: "再查", at: 2),
			reply("a2", text: "好"),
		])
		#expect(chat.lines.map(\.id) == ["ts", "u1", "a1-head", "a1-text", "a1-foot", "u2", "a2-head", "a2-text", "a2-foot"])
		#expect(chat.latest == 5)
		#expect(ChatLines.build([reply("a1", text: "你好")]).latest == 4, "nothing sent yet: past the end")
	}

	@Test func onlyTheLastPieceOfAStreamingTurnIsLiveAndItHasNoCopyYet() {
		let chat = ChatLines.build([
			.user(id: "u1", text: "开始", at: 1),
			reply("a1", text: "先跑测试", tools: [tool("t1")]),
			reply("a2", tools: [tool("t2")], streaming: true),
		])
		let pieces = chat.lines.compactMap { line -> (String, Bool, Bool)? in
			guard case let .piece(segment, live, ends, _) = line else { return nil }
			return (segment.id, live, ends)
		}
		#expect(pieces.map(\.0) == ["a1-work", "a1-text", "a2-work"])
		#expect(pieces.map(\.1) == [false, false, true])
		#expect(pieces.map(\.2) == [false, false, true], "the last piece closes the turn")
		#expect(!chat.lines.contains { $0.id == "a1-foot" })
	}

	@Test func aTurnStillWaitingForTheModelEndsAtItsHeader() {
		let chat = ChatLines.build([.user(id: "u1", text: "开始", at: 1)], waiting: true)
		guard case let .head(id, _, streaming, empty, ends)? = chat.lines.last else {
			Issue.record("no header")
			return
		}
		#expect(id == "pending-turn" && streaming && empty && ends)
	}
}
