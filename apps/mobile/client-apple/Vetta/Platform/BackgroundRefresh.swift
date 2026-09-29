import BackgroundTasks
import UIKit

/// Background time for session news, within what iOS grants without push.
enum BackgroundRefresh {
	static let identifier = "com.openvetta.mobile.refresh"

	/// Asks to be woken in a while to look at the sessions again. iOS decides
	/// when, going by how the app is used, and may not at all.
	static func schedule() {
		let request = BGAppRefreshTaskRequest(identifier: identifier)
		request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
		try? BGTaskScheduler.shared.submit(request)
	}
}

/// The half minute iOS allows after the app leaves the screen, so a reply that
/// is about to finish still raises its notification before the link goes quiet.
final class BackgroundGrace {
	private var task: UIBackgroundTaskIdentifier = .invalid

	func begin() {
		guard task == .invalid else { return }
		task = UIApplication.shared.beginBackgroundTask(withName: "vetta.sessions") { [weak self] in self?.end() }
	}

	func end() {
		guard task != .invalid else { return }
		UIApplication.shared.endBackgroundTask(task)
		task = .invalid
	}
}
