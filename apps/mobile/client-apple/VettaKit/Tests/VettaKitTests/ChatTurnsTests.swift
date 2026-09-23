import Foundation
import Testing
@testable import VettaKit

@Suite struct ChatTurnsTests {
	private func reply(_ id: String, text: String = "", thinking: String = "", tools: [ToolCard] = [], streaming: Bool = false, error: String? = nil) -> TranscriptItem {
		.assistant(AssistantTurn(id: id, text: text, thinking: thinking, tools: tools, streaming: streaming, at: 1, error: error))
	}

	private func tool(_ id: String, _ status: ToolCardStatus = .done) -> ToolCard {
		ToolCard(toolCallId: id, toolName: "bash", status: status)
	}

	private func turns(_ blocks: [ChatBlock]) -> [AgentTurn] {
		blocks.compactMap { if case let .turn(turn) = $0 { return turn } else { return nil } }
	}

	@Test func mergesEveryReplyBetweenTwoUserMessagesIntoOneTurn() {
		let blocks = ChatTurns.build([
			.user(id: "u1", text: "查一下", at: 1),
			reply("a1", thinking: "先看看", tools: [tool("t1")]),
			reply("a2", tools: [tool("t2")]),
			reply("a3", text: "查到了"),
			.user(id: "u2", text: "谢谢", at: 2),
			reply("a4", text: "不客气"),
		])
		#expect(blocks.map(\.id) == ["u1", "a1", "u2", "a4"])
		let first = turns(blocks)[0]
		#expect(first.segments == [
			.work(id: "a1-work", steps: [.thinking(id: "a1-thinking", text: "先看看"), .tool(tool("t1")), .tool(tool("t2"))]),
			.text(id: "a3-text", text: "查到了"),
		])
		#expect(first.conclusion == "查到了")
	}

	@Test func textBetweenToolRoundsClosesTheWorkGroup() {
		let turn = turns(ChatTurns.build([
			reply("a1", text: "我先跑测试", tools: [tool("t1")]),
			reply("a2", text: "修好了", tools: [tool("t2")]),
		]))[0]
		#expect(turn.segments.map(\.id) == ["a1-work", "a1-text", "a2-work", "a2-text"])
		#expect(turn.conclusion == "修好了", "the copy button takes the answer after the last work group")
	}

	@Test func aMarkerEndsTheTurnButAnErrorStaysInside() {
		let blocks = ChatTurns.build([
			reply("a1", text: "第一段"),
			reply("a2", error: "rate limited"),
			.marker(id: "m1", text: "上下文已压缩", at: 3),
			reply("a3", text: "继续"),
		])
		#expect(blocks.map(\.id) == ["a1", "m1", "a3"])
		#expect(turns(blocks)[0].segments == [.text(id: "a1-text", text: "第一段"), .error(id: "a2-error", message: "rate limited", count: 1)])
	}

	@Test func repeatedFailuresShowOnceWithACountAndARetryThatWorksHidesThem() {
		let failing = ChatTurns.build([
			.user(id: "u1", text: "这是个什么项目", at: 1),
			reply("a1", error: "Connection error."),
			reply("a2", error: "Connection error."),
			reply("a3", error: "Connection error."),
		])
		#expect(failing.map(\.id) == ["u1", "a1"], "one turn, not one per attempt")
		#expect(turns(failing)[0].segments == [.error(id: "a1-error", message: "Connection error.", count: 3)])

		let recovered = ChatTurns.build([
			reply("a1", error: "Connection error."),
			reply("a2", error: "Connection error."),
			reply("a3", text: "这是一个 Electron 项目"),
		])
		#expect(turns(recovered)[0].segments == [.text(id: "a3-text", text: "这是一个 Electron 项目")])
	}

	@Test func aWorkingSessionAlwaysShowsATurnToWatch() {
		let justSent = ChatTurns.build([.user(id: "u1", text: "你好", at: 1)], waiting: true)
		#expect(justSent.map(\.id) == ["u1", "pending-turn"])
		#expect(turns(justSent)[0].streaming && turns(justSent)[0].segments.isEmpty)

		let retrying = ChatTurns.build([.user(id: "u1", text: "你好", at: 1), reply("a1", error: "Connection error.")], waiting: true)
		#expect(retrying.map(\.id) == ["u1", "a1"], "a retry keeps the same turn, now live again")
		#expect(turns(retrying)[0].streaming)
		#expect(ChatTurns.build([.user(id: "u1", text: "你好", at: 1)]).count == 1)
	}

	@Test func followsTheLiveStepWhileStreaming() {
		let running = ToolCard(toolCallId: "t2", toolName: "web_search", status: .running)
		let turn = turns(ChatTurns.build([
			reply("a1", tools: [tool("t1")]),
			reply("a2", tools: [running], streaming: true),
		]))[0]
		#expect(turn.streaming)
		#expect(turn.activity == .tool(running))
		#expect(turn.conclusion == "")
		let done = turns(ChatTurns.build([reply("a1", text: "好", tools: [tool("t1")])]))[0]
		#expect(done.activity == nil)
	}

	@Test func skipsBlankThinkingAndText() {
		let turn = turns(ChatTurns.build([reply("a1", text: "  \n", thinking: " ", tools: [tool("t1")])]))[0]
		#expect(turn.segments == [.work(id: "a1-work", steps: [.tool(tool("t1"))])])
	}
}
