import ActivityKit
import Foundation
import os
import VettaKit

private let log = Logger(subsystem: "com.openvetta.mobile", category: "activity")

/// Keeps one Live Activity in step with the busy sessions. ActivityKit only
/// starts one while the app is in front; after that the app updates it for as
/// long as it runs, and the stale date marks it once the app has been suspended
/// too long to know.
final class LiveActivityController {
	/// How long an update stays trustworthy without the next one.
	private static let freshFor: TimeInterval = 15 * 60
	/// How long the finished activity stays on the Lock Screen.
	private static let doneFor: TimeInterval = 10 * 60

	private var current: Activity<SessionActivityAttributes>?
	private var shown: LiveDigest?
	/// The digest from the sessions, under what `answering` shows for a moment.
	private var latest: LiveDigest = .idle
	private var pushedAt = Date.distantPast
	/// Swiped away by the user: no new one until the current work is all done.
	private var dismissed = false

	init() {
		current = Activity<SessionActivityAttributes>.activities.first
		shown = current?.content.state
	}

	/// An unchanged digest is sent again at most once a minute, to push the stale date back.
	func show(_ digest: LiveDigest, active: Bool) {
		latest = digest
		if let activity = current, activity.activityState == .dismissed || activity.activityState == .ended {
			dismissed = activity.activityState == .dismissed
			current = nil
		}
		guard digest.busy else {
			dismissed = false
			end(digest)
			return
		}
		let due = Date().timeIntervalSince(pushedAt) > 60
		guard due || digest != shown || current == nil else { return }
		let content = ActivityContent(state: digest, staleDate: Date().addingTimeInterval(Self.freshFor))
		if let activity = current {
			shown = digest
			pushedAt = Date()
			let id = activity.id
			Task { await Self.update(id, content) }
		} else if active, !dismissed, ActivityAuthorizationInfo().areActivitiesEnabled {
			do {
				current = try Activity.request(attributes: SessionActivityAttributes(), content: content)
				shown = digest
				pushedAt = Date()
			} catch {
				log.error("activity request failed: \(error.localizedDescription, privacy: .public)")
			}
		}
	}

	/// A choice was tapped: the buttons give way to what was chosen until the
	/// sessions report back.
	func answering(_ sessionId: String, choice: String) {
		guard let activity = current, var digest = shown, digest.headline?.sessionId == sessionId else { return }
		digest.headline?.question = nil
		digest.headline?.answering = choice
		shown = digest
		pushedAt = Date()
		let id = activity.id
		let content = ActivityContent(state: digest, staleDate: Date().addingTimeInterval(Self.freshFor))
		Task { await Self.update(id, content) }
	}

	/// The answer did not reach the desktop: the buttons come back.
	func answerFailed() {
		show(latest, active: false)
	}

	private func end(_ digest: LiveDigest) {
		guard let activity = current else { return }
		current = nil
		shown = nil
		let final = ActivityContent(state: digest, staleDate: nil)
		let dismissal = ActivityUIDismissalPolicy.after(Date().addingTimeInterval(Self.doneFor))
		let id = activity.id
		Task { await Self.end(id, final, dismissal) }
	}

	// `Activity` is not Sendable, so these look it up again by id off the main actor.

	@concurrent private nonisolated static func update(_ id: String, _ content: ActivityContent<LiveDigest>) async {
		await find(id)?.update(content)
	}

	@concurrent private nonisolated static func end(_ id: String, _ content: ActivityContent<LiveDigest>, _ dismissal: ActivityUIDismissalPolicy) async {
		await find(id)?.end(content, dismissalPolicy: dismissal)
	}

	private nonisolated static func find(_ id: String) -> Activity<SessionActivityAttributes>? {
		Activity<SessionActivityAttributes>.activities.first { $0.id == id }
	}
}
