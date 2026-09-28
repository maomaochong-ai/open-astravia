import Foundation
import UserNotifications
import VettaKit

/// Tells the user about sessions while Vetta is not in front: a local
/// notification per session, the number waiting on the icon badge, and the
/// Live Activity. Nothing goes through Apple's push service, so this only works
/// while iOS lets the app run: shortly after it leaves the screen, and when a
/// background refresh wakes it.
@Observable
final class SessionNotifier: NSObject, SessionSignals {
	/// A session the user tapped a notification or the Live Activity for; the root view opens it.
	var requestedSession: String?

	@ObservationIgnored private let center = UNUserNotificationCenter.current()
	@ObservationIgnored private let activity = LiveActivityController()
	@ObservationIgnored private var badge: Int?

	override init() {
		super.init()
		// Before launch finishes, so a tap that launched the app is delivered.
		center.delegate = self
	}

	/// Asks once; iOS remembers the answer and later calls return it silently.
	func requestAuthorization() async {
		_ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
	}

	func alert(_ alert: SessionAlert) {
		let content = UNMutableNotificationContent()
		content.title = alert.title
		switch alert.kind {
		case .needsInput: content.body = alert.detail.map(L10n.Notify.needsInputDetail) ?? L10n.Notify.needsInput
		case .finished: content.body = L10n.Notify.finished
		case .failed: content.body = L10n.Notify.failed
		}
		content.sound = .default
		content.threadIdentifier = alert.sessionId
		content.userInfo = [Self.sessionKey: alert.sessionId]
		// One per session: news about it replaces what was said before.
		center.add(UNNotificationRequest(identifier: Self.identifier(alert.sessionId), content: content, trigger: nil))
	}

	func withdraw(_ sessionId: String) {
		center.removeDeliveredNotifications(withIdentifiers: [Self.identifier(sessionId)])
	}

	func show(_ digest: LiveDigest, active: Bool) {
		if badge != digest.waiting {
			badge = digest.waiting
			center.setBadgeCount(digest.waiting)
		}
		activity.show(digest, active: active)
	}

	/// A choice was tapped on the Live Activity; see `LiveActivityController.answering`.
	func answering(_ sessionId: String, choice: String) {
		activity.answering(sessionId, choice: choice)
	}

	func answerFailed() {
		activity.answerFailed()
	}

	private nonisolated static let sessionKey = "sessionId"

	private static func identifier(_ sessionId: String) -> String { "session.\(sessionId)" }
}

extension SessionNotifier: UNUserNotificationCenterDelegate {
	// Called off the main thread, so neither method may inherit the main actor.
	nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
		guard let sessionId = response.notification.request.content.userInfo[Self.sessionKey] as? String else { return }
		await MainActor.run { requestedSession = sessionId }
	}

	/// In front the app shows the session itself; a notification that raced the return stays quiet.
	nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
		[]
	}
}
