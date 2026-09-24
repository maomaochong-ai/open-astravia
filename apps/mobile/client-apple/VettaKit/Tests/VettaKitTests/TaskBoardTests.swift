import Foundation
import Testing
@testable import VettaKit

@Suite struct TaskBoardTests {
	private func session(_ id: String, _ status: RemoteSessionStatus = .completed, cwd: String, at: Double) -> RemoteSessionSummary {
		RemoteSessionSummary(id: id, projectCwd: cwd, projectName: String(cwd.dropFirst()), title: id, updatedAt: at, status: status, live: false)
	}

	@Test func ranksWaitingThenRunningThenConversationsThenDone() {
		let sessions = [
			session("done", cwd: "/done", at: 90),
			session("run", .running, cwd: "/run", at: 10),
			session("chat", cwd: "/conv", at: 1),
			session("wait", .waitingInput, cwd: "/wait", at: 5),
		]
		let cards = TaskBoard.cards(sessions, conversationCwd: "/conv")
		#expect(cards.map(\.cwd) == ["/wait", "/run", "/conv", "/done"])
		#expect(cards.map(\.score) == [100, 10, 5, 1])
	}

	@Test func scoresAddUpSoWaitingAndRunningOutranksWaitingAlone() {
		let sessions = [
			session("w1", .waitingInput, cwd: "/a", at: 50),
			session("w2", .waitingInput, cwd: "/b", at: 1),
			session("r2", .thinking, cwd: "/b", at: 2),
		]
		let cards = TaskBoard.cards(sessions, conversationCwd: "/conv")
		#expect(cards.map(\.cwd) == ["/b", "/a"])
		#expect(cards[0].score == 110)
	}

	@Test func conversationsFollowTheirSessionsAndLeadTheirTier() {
		let sessions = [
			session("w", .waitingInput, cwd: "/a", at: 99),
			session("chat", .waitingInput, cwd: "/conv", at: 1),
		]
		let cards = TaskBoard.cards(sessions, conversationCwd: "/conv")
		#expect(cards.map(\.cwd) == ["/conv", "/a"])
		#expect(cards[0].score == 105)
		#expect(cards[0].isConversation)
	}

	@Test func sameScoreGoesMostRecentFirst() {
		let sessions = [session("old", cwd: "/old", at: 1), session("new", cwd: "/new", at: 2)]
		#expect(TaskBoard.cards(sessions, conversationCwd: "/conv").map(\.cwd) == ["/new", "/old"])
	}

	@Test func activeCardListsWaitingThenRunningThenFillsUpWithTheNewestOthers() {
		let sessions = [
			session("done", cwd: "/a", at: 100),
			session("run", .running, cwd: "/a", at: 50),
			session("wait", .waitingInput, cwd: "/a", at: 10),
			session("error", .error, cwd: "/a", at: 60),
			session("old", cwd: "/a", at: 1),
		]
		let card = TaskBoard.cards(sessions, conversationCwd: "/conv")[0]
		#expect(card.sessions.map(\.id) == ["wait", "run", "done"])
		#expect(card.waiting == 1)
		#expect(card.running == 1)
		#expect(card.updatedAt == 100)
	}

	@Test func doneCardListsItsNewestThreeCountingErrorsAsDone() {
		let sessions = (1 ... 5).map { session("s\($0)", $0 == 5 ? .error : .completed, cwd: "/a", at: Double($0)) }
		let card = TaskBoard.cards(sessions, conversationCwd: "/conv")[0]
		#expect(card.sessions.map(\.id) == ["s5", "s4", "s3"])
		#expect(card.score == 1)
		#expect(card.hidden == 0)
	}

	@Test func capsActiveSessionsAndCountsTheRest() {
		let sessions = (1 ... 8).map { session("r\($0)", .running, cwd: "/a", at: Double($0)) }
		let card = TaskBoard.cards(sessions, conversationCwd: "/conv")[0]
		#expect(card.sessions.count == TaskBoard.activeLimit, "enough active ones leave no room for finished ones")
		#expect(card.sessions.first?.id == "r8")
		#expect(card.hidden == 3)
	}

	@Test func keepsOnlyTheNewestAllDoneProjectsButEveryActiveOne() {
		var sessions = (1 ... 9).map { session("d\($0)", cwd: "/d\($0)", at: Double($0)) }
		sessions.append(session("chat", cwd: "/conv", at: 0))
		sessions += (1 ... 8).map { session("r\($0)", .running, cwd: "/r\($0)", at: Double($0)) }
		let cards = TaskBoard.cards(sessions, conversationCwd: "/conv")
		#expect(cards.filter(\.active).count == 8)
		#expect(cards.contains { $0.isConversation }, "the conversations are not a project and stay")
		let done = cards.filter { !$0.active && !$0.isConversation }
		#expect(done.map(\.cwd) == ["/d9", "/d8", "/d7", "/d6", "/d5", "/d4"])
	}

	@Test func showsNothingUntilTheConversationBucketIsKnown() {
		#expect(TaskBoard.cards([session("x", cwd: "/a", at: 1)], conversationCwd: nil).isEmpty)
	}

	@Test func columnsFillTheShortestFirst() {
		let sessions = [
			session("a1", .running, cwd: "/a", at: 9), session("a2", .running, cwd: "/a", at: 8), session("a3", .running, cwd: "/a", at: 7),
			session("b1", .running, cwd: "/b", at: 6),
			session("c1", .running, cwd: "/c", at: 5),
			session("d1", .running, cwd: "/d", at: 4),
		]
		let cards = TaskBoard.cards(sessions, conversationCwd: "/conv")
		let columns = TaskBoard.columns(cards, count: 2)
		#expect(columns.map { $0.map(\.cwd) } == [["/a", "/d"], ["/b", "/c"]])
	}
}
