import Foundation
import Testing
@testable import VettaKit

@Suite struct SessionFilterTests {
	private func session(_ id: String, _ status: RemoteSessionStatus, cwd: String = "/conv", name: String = "对话", at: Double) -> RemoteSessionSummary {
		RemoteSessionSummary(id: id, projectCwd: cwd, projectName: name, title: id, updatedAt: at, status: status, live: false)
	}

	private var sessions: [RemoteSessionSummary] {
		[
			session("chat-done", .completed, at: 50),
			session("chat-ask", .waitingInput, at: 10),
			session("app-run", .running, cwd: "/code/app", name: "app", at: 40),
			session("app-think", .thinking, cwd: "/code/app", name: "app", at: 45),
			session("app-fail", .error, cwd: "/code/app", name: "app", at: 30),
			session("web-ask", .waitingInput, cwd: "/code/web", name: "web", at: 20),
			session("web-stop", .aborted, cwd: "/code/web", name: "web", at: 60),
			session("web-idle", .idle, cwd: "/code/web", name: "web", at: 5),
		]
	}

	private func ids(_ filter: SessionFilter) -> [String] {
		filter.apply(sessions, conversationCwd: "/conv").map(\.id)
	}

	@Test func groupsStatusesSoWaitingIsNotAlsoProcessing() {
		#expect(SessionStatusGroup(.waitingInput) == .waiting)
		#expect([RemoteSessionStatus.running, .thinking].map(SessionStatusGroup.init) == [.processing, .processing])
		#expect([RemoteSessionStatus.idle, .completed, .error, .aborted].map(SessionStatusGroup.init) == [.done, .done, .done, .done])
	}

	@Test func pinsWaitingSessionsAboveEverythingElseThenNewestFirst() {
		#expect(ids(SessionFilter()) == ["web-ask", "chat-ask", "web-stop", "chat-done", "app-think", "app-run", "app-fail", "web-idle"])
	}

	@Test func narrowsByStatusKindAndProject() {
		#expect(ids(SessionFilter(status: .processing)) == ["app-think", "app-run"])
		#expect(ids(SessionFilter(status: .done, kind: .conversation)) == ["chat-done"])
		#expect(ids(SessionFilter(kind: .project)) == ["web-ask", "web-stop", "app-think", "app-run", "app-fail", "web-idle"])
		#expect(ids(SessionFilter(status: .waiting, kind: .project, projectCwd: "/code/web")) == ["web-ask"])
	}

	@Test func leavingTheProjectKindForgetsTheChosenProject() {
		var filter = SessionFilter(kind: .project, projectCwd: "/code/app")
		filter.kind = .conversation
		#expect(filter.projectCwd == nil)
		filter.kind = .project
		#expect(ids(filter).count == 6, "back to all projects, not the one picked before")
		#expect(SessionFilter(kind: .conversation, projectCwd: "/code/app").projectCwd == nil)
	}

	@Test func listsTheProjectsThatHaveSessionsWithTheirCounts() {
		let projects = SessionFilter.projects(in: sessions, conversationCwd: "/conv")
		#expect(projects.map(\.name) == ["app", "web"])
		#expect(projects.map(\.count) == [3, 3])
	}

	@Test func treatsEverySessionAsAProjectUntilTheConversationBucketIsKnown() {
		#expect(SessionFilter(kind: .conversation).apply(sessions, conversationCwd: nil).isEmpty)
		#expect(SessionFilter(kind: .project).apply(sessions, conversationCwd: nil).count == sessions.count)
	}
}
