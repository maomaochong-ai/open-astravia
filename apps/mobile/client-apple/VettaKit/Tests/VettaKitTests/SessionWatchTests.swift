import Foundation
import Testing
@testable import VettaKit

@Suite struct SessionWatchTests {
	private func session(_ id: String, _ status: RemoteSessionStatus, title: String? = nil, preview: String? = nil, at: Double = 1) -> RemoteSessionSummary {
		RemoteSessionSummary(id: id, projectCwd: "/conv", projectName: "对话", title: title ?? id, preview: preview, updatedAt: at, status: status, live: true)
	}

	private func kinds(_ alerts: [SessionAlert]) -> [String: SessionAlert.Kind] {
		Dictionary(uniqueKeysWithValues: alerts.map { ($0.sessionId, $0.kind) })
	}

	@Test func announcesQuestionsFinishedTurnsAndFailures() {
		var watch = SessionWatch()
		let old = [session("q", .running), session("done", .running), session("late", .thinking), session("bad", .running), session("stop", .running)]
		let new = [session("q", .waitingInput), session("done", .completed), session("late", .idle), session("bad", .error), session("stop", .aborted)]
		let alerts = watch.update(from: old, to: new) { $0 == "q" ? "要发邮件吗？" : nil }
		#expect(kinds(alerts) == ["q": .needsInput, "done": .finished, "late": .finished, "bad": .failed])
		#expect(alerts.first { $0.sessionId == "q" }?.detail == "要发邮件吗？")
	}

	@Test func staysQuietForNewSessionsAndStatusesThatAreNotNews() {
		var watch = SessionWatch()
		// Restored from the cache, then fetched: nothing was seen change.
		#expect(watch.update(from: [], to: [session("a", .waitingInput), session("b", .completed)]).isEmpty)
		// A finished turn settling to idle, a question withdrawn, work starting.
		let old = [session("a", .waitingInput), session("b", .completed), session("c", .idle), session("d", .running)]
		let new = [session("a", .idle), session("b", .idle), session("c", .running), session("d", .thinking)]
		#expect(watch.update(from: old, to: new).isEmpty)
	}

	@Test func anAnsweredQuestionThatEndsTheTurnIsFinished() {
		var watch = SessionWatch()
		let alerts = watch.update(from: [session("a", .waitingInput)], to: [session("a", .completed)])
		#expect(kinds(alerts) == ["a": .finished])
	}

	@Test func titlesFallBackToThePreview() {
		var watch = SessionWatch()
		let alerts = watch.update(from: [session("a", .running, title: " ")], to: [session("a", .completed, title: " ", preview: "帮我写周报")])
		#expect(alerts.first?.title == "帮我写周报")
	}

	@Test func digestLeadsWithTheNewestQuestionAndCountsFromWhenWorkStarted() {
		var watch = SessionWatch()
		_ = watch.update(from: [], to: [session("old", .idle, at: 1)], now: 100)
		_ = watch.update(from: [session("old", .idle, at: 1)], to: [session("old", .running, at: 150)], now: 200)
		let sessions = [session("old", .running, at: 300), session("new", .running, at: 400)]
		_ = watch.update(from: [session("old", .running, at: 150)], to: sessions, now: 500)
		let running = watch.digest(sessions)
		#expect(running.running == 2 && running.waiting == 0)
		#expect(running.headline?.sessionId == "new")
		// Busy the first time it is seen: counts from then.
		#expect(running.headline?.since == 500)
		#expect(watch.digest([session("old", .running, at: 300)]).headline?.since == 200)

		let asking = [session("old", .waitingInput, at: 300), session("new", .running, at: 400)]
		let digest = watch.digest(asking)
		#expect(digest.waiting == 1 && digest.running == 1)
		#expect(digest.headline?.sessionId == "old")
		#expect(digest.headline?.waiting == true)
	}

	@Test func digestIsIdleWhenNothingIsBusy() {
		let digest = SessionWatch().digest([session("a", .completed), session("b", .aborted)])
		#expect(digest == .idle)
		#expect(!digest.busy)
	}
}

@Suite struct SessionLinkTests {
	@Test func roundTripsASessionIdAndIgnoresOtherLinks() throws {
		let url = SessionLink.url("a b/c?d")
		#expect(url.absoluteString.hasPrefix("vetta://session?id="))
		#expect(SessionLink.sessionId(url) == "a b/c?d")
		#expect(SessionLink.sessionId(try #require(URL(string: "vetta://pair?v=2"))) == nil)
		#expect(SessionLink.sessionId(try #require(URL(string: "vetta://session"))) == nil)
		#expect(SessionLink.sessionId(try #require(URL(string: "https://session?id=x"))) == nil)
	}
}

@Suite struct LiveQuestionTests {
	private func request(_ items: [RemoteQuestionItem]) -> RemoteQuestionRequest {
		RemoteQuestionRequest(requestId: "q1", questions: items)
	}

	private func item(_ labels: [String], multi: Bool = false, question: String = "继续吗？") -> RemoteQuestionItem {
		RemoteQuestionItem(question: question, header: "确认", options: labels.map { RemoteQuestionOption(label: $0, description: "") }, multiSelect: multi)
	}

	@Test func offersOneSingleChoiceQuestionWithAFewShortOptions() throws {
		let live = try #require(LiveQuestion(request([item(["继续", "先停下"])])))
		#expect(live.requestId == "q1")
		#expect(live.question == "继续吗？")
		#expect(live.options == ["继续", "先停下"])
	}

	@Test func leavesEverythingElseToTheApp() {
		#expect(LiveQuestion(request([item(["发", "不发"], multi: true)])) == nil)
		#expect(LiveQuestion(request([item(["是", "否"]), item(["产品", "测试"])])) == nil)
		#expect(LiveQuestion(request([item(["一", "二", "三", "四"])])) == nil)
		#expect(LiveQuestion(request([item([])])) == nil)
		#expect(LiveQuestion(request([item([String(repeating: "长", count: 41), "短"])])) == nil)
	}

	@Test func cutsALongQuestionForDisplayButAnswersTheWholeOne() throws {
		let long = String(repeating: "问", count: 300)
		let live = try #require(LiveQuestion(request([item(["好"], question: long)])))
		#expect(live.question == long)
		#expect(live.text.count == 160)
	}

	@Test func digestCarriesTheQuestionOfTheWaitingLead() {
		let sessions = [
			RemoteSessionSummary(id: "a", projectCwd: "/c", projectName: "c", title: "a", updatedAt: 2, status: .waitingInput, live: true),
			RemoteSessionSummary(id: "b", projectCwd: "/c", projectName: "c", title: "b", updatedAt: 1, status: .running, live: true),
		]
		let digest = SessionWatch().digest(sessions) { $0 == "a" ? request([item(["继续", "先停下"])]) : nil }
		#expect(digest.headline?.question?.options == ["继续", "先停下"])
		#expect(SessionWatch().digest(sessions).headline?.question == nil)
	}
}
