import Foundation
import Testing
@testable import VettaKit

@Suite struct HomeDigestTests {
	private func session(_ id: String, _ status: RemoteSessionStatus = .completed, cwd: String = "/conv", name: String = "对话", title: String? = nil, preview: String? = nil, at: Double, pinnedAt: Double? = nil) -> RemoteSessionSummary {
		RemoteSessionSummary(id: id, projectCwd: cwd, projectName: name, title: title ?? id, preview: preview, updatedAt: at, status: status, live: false, pinnedAt: pinnedAt)
	}

	@Test func picksTheThreeMostRecentlyActiveProjectsAndLeavesConversationsOut() {
		let sessions = [
			session("chat", cwd: "/conv", at: 100),
			session("a1", cwd: "/a", name: "a", at: 10),
			session("b1", cwd: "/b", name: "b", at: 50),
			session("c1", cwd: "/c", name: "c", at: 30),
			session("d1", cwd: "/d", name: "d", at: 5),
			session("a2", cwd: "/a", name: "a", at: 60),
		]
		let recent = ProjectDigest.recent(sessions, conversationCwd: "/conv")
		#expect(recent.map(\.cwd) == ["/a", "/b", "/c"])
		#expect(recent[0].sessionCount == 2)
		#expect(recent[0].updatedAt == 60)
	}

	@Test func listsNothingUntilTheConversationBucketIsKnown() {
		#expect(ProjectDigest.recent([session("x", cwd: "/conv", at: 1)], conversationCwd: nil).isEmpty)
	}

	@Test func cardListsWaitingSessionsFirstThenNewestAndIgnoresPins() {
		let sessions = [
			session("old-pinned", cwd: "/a", name: "a", at: 1, pinnedAt: 99),
			session("new", .running, cwd: "/a", name: "a", at: 40),
			session("ask", .waitingInput, cwd: "/a", name: "a", at: 10),
			session("mid", cwd: "/a", name: "a", at: 20),
		]
		let card = ProjectDigest.recent(sessions, conversationCwd: "/conv")[0]
		#expect(card.recent.map(\.id) == ["ask", "new"])
		#expect(card.sessionCount == 4)
	}

	@Test func conversationsCardSummarisesTheProjectlessChats() throws {
		let sessions = [
			session("c1", cwd: "/conv", at: 10),
			session("c2", .waitingInput, cwd: "/conv", at: 5),
			session("c3", cwd: "/conv", at: 30),
			session("a1", cwd: "/a", name: "a", at: 99),
		]
		let card = try #require(ProjectDigest.conversations(sessions, conversationCwd: "/conv"))
		#expect(card.recent.map(\.id) == ["c2", "c3"])
		#expect(card.sessionCount == 3)
		#expect(card.updatedAt == 30)
		#expect(ProjectDigest.conversations(sessions, conversationCwd: nil) == nil)
		#expect(ProjectDigest.conversations([sessions[3]], conversationCwd: "/conv") == nil, "no card without a chat")
	}

	@Test func allProjectsAddsDesktopProjectsWithoutSessionsAtTheEnd() {
		let sessions = [session("a1", cwd: "/a", name: "a", at: 10)]
		let projects = [
			RemoteProjectSummary(cwd: "/conv", name: "对话", kind: "conversation", sessionCount: 9),
			RemoteProjectSummary(cwd: "/a", name: "a", kind: "project", sessionCount: 7),
			RemoteProjectSummary(cwd: "/z", name: "z", kind: "project", sessionCount: 3),
		]
		let all = ProjectDigest.all(sessions, projects: projects, conversationCwd: "/conv")
		#expect(all.map(\.cwd) == ["/a", "/z"])
		#expect(all.map(\.sessionCount) == [1, 3], "a project with sessions counts what the list shows")
	}

	@Test func searchMatchesTitlePreviewAndProjectIgnoringCase() {
		let row = session("s", cwd: "/a", name: "Mobile App", title: "Dock 液态玻璃", preview: "Fix the Aurora glow", at: 1)
		#expect(HomeSearch.matches(row, ""))
		#expect(HomeSearch.matches(row, "  "))
		#expect(HomeSearch.matches(row, "液态"))
		#expect(HomeSearch.matches(row, "aurora"))
		#expect(HomeSearch.matches(row, "mobile"))
		#expect(HomeSearch.matches(row, "dock glow"), "every word must match, each anywhere")
		#expect(!HomeSearch.matches(row, "dock desktop"))
	}

	@Test func projectSearchNeedsAQuery() {
		let project = ProjectDigest(cwd: "/a", name: "智能助手工作流", sessionCount: 1, updatedAt: 1, recent: [])
		#expect(!HomeSearch.matches(project, ""))
		#expect(HomeSearch.matches(project, "助手"))
		#expect(!HomeSearch.matches(project, "客服"))
	}
}
