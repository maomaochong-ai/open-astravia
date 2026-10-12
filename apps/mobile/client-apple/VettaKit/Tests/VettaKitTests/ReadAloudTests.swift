import Foundation
import Testing
@testable import VettaKit

@Suite struct ReadAloudTests {
	@Test func codeBlocksTablesAndMarkupAreNotRead() {
		let reply = """
		## 结果

		改好了 **两处**，见 [main.swift](vetta-file:///a/main.swift)：

		```swift
		let x = 1
		```

		| 文件 | 行数 |
		| --- | --- |
		| a | 3 |

		- 运行 `swift test`
		- 详情 https://example.com/x
		---
		> 注意 ~~旧的~~ 新的
		"""
		#expect(SpeakableText.plain(reply) == """
		结果
		改好了 两处，见 main.swift：
		文件, 行数
		a, 3
		运行 swift test
		详情
		注意 旧的 新的
		""")
	}

	@Test func anUnclosedCodeBlockIsSkippedToTheEnd() {
		#expect(SpeakableText.plain("看这里：\n```\nrm -rf /tmp/x\n") == "看这里：")
	}

	private func readable(_ text: String) -> String {
		String(text[..<SpeakableText.boundary(text, from: text.startIndex)])
	}

	@Test func aReplyBeingWrittenIsReadUpToItsLastFinishedSentence() {
		#expect(readable("第一句。第二句还没") == "第一句。")
		#expect(readable("First one. Second") == "First one.")
		#expect(readable("一行\n半行") == "一行\n")
		#expect(readable("Version 3.14 is") == "", "a decimal point is not a sentence end")
		#expect(readable("1. 第一步") == "", "nor is a list number")
	}

	@Test func readingNeverStopsInsideCodeOrALink() {
		#expect(readable("先说明。\n```\nlet a = 1。\n") == "先说明。\n")
		#expect(readable("先说明。\n``") == "先说明。\n", "a fence still being typed")
		#expect(readable("见 [说明。文档") == "", "a link not yet closed")
		#expect(readable("运行 `a. b` 后") == "")
		#expect(readable("```\nx\n```\n后面。") == "```\nx\n```\n后面。")
	}

	private func source(_ turnId: String, _ texts: [(String, String)], streaming: Bool) -> SpeechSource {
		SpeechSource(turnId: turnId, texts: texts.map { SpeechSource.Piece(id: $0.0, text: $0.1) }, streaming: streaming)
	}

	@Test func aStreamingReplyIsHandedOutSentenceBySentenceOnce() {
		var feed = SpeechFeed()
		#expect(feed.next(source(ChatTurns.pendingTurnId, [], streaming: true)).isEmpty)
		#expect(feed.next(source("a1", [("a1-text", "好的，")], streaming: true)).isEmpty)
		#expect(feed.next(source("a1", [("a1-text", "好的，我来看看。然后")], streaming: true)) == ["好的，我来看看。"])
		#expect(feed.next(source("a1", [("a1-text", "好的，我来看看。然后")], streaming: true)).isEmpty)
		let texts = [("a1-text", "好的，我来看看。然后跑测试。"), ("a2-text", "全部**通过**")]
		#expect(feed.next(source("a1", texts, streaming: true)) == ["然后跑测试。"])
		#expect(feed.next(source("a1", texts, streaming: false)) == ["全部通过"], "the end reads what is left")
		#expect(feed.next(source("a1", texts, streaming: false)).isEmpty)
	}

	@Test func historyIsSilentAndATurnJoinedMidwayStartsAtItsLatestText() {
		var feed = SpeechFeed()
		#expect(feed.next(source("old", [("old-text", "早先的回复。")], streaming: false)).isEmpty)
		let texts = [("b1-text", "已经说过的。"), ("b2-text", "正在说的。")]
		#expect(feed.next(source("b1", texts, streaming: true)) == ["正在说的。"])
	}

	@Test func theLatestTurnsTextsComeFromTheChatRows() {
		let rows = ChatLines.build([
			.user(id: "u1", text: "开始", at: 1),
			.assistant(AssistantTurn(id: "a1", text: "第一段", thinking: "", tools: [ToolCard(toolCallId: "t1", toolName: "bash", status: .done)], streaming: false, at: 1)),
			.assistant(AssistantTurn(id: "a2", text: "第二段", thinking: "", tools: [], streaming: true, at: 2)),
		]).lines
		let latest = SpeechSource.latest(rows)
		#expect(latest?.turnId == "a1")
		#expect(latest?.texts.map(\.text) == ["第一段", "第二段"])
		#expect(latest?.streaming == true)
	}
}
