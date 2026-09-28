import Observation
import UIKit
import VettaKit

/// Portrait everywhere except the remote desktop, which may turn to landscape.
enum OrientationLock {
	static private(set) var mask: UIInterfaceOrientationMask = .portrait

	/// Allows `next` and turns the screen to `turn` (or the first of `next`) at once.
	static func allow(_ next: UIInterfaceOrientationMask, turn: UIInterfaceOrientationMask? = nil) {
		mask = next
		for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
			for window in scene.windows { window.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations() }
			scene.requestGeometryUpdate(.iOS(interfaceOrientations: turn ?? next)) { _ in }
		}
	}
}

/// Long-pressing the app icon offers Remote Control once a computer is paired; picking it
/// opens the remote desktop, whether the app was running or not.
@Observable
final class QuickActions {
	static let shared = QuickActions()
	static let remoteType = "com.openvetta.mobile.remote"

	/// Set by the icon's menu, taken by the root view once it can act on it.
	var remoteRequested = false

	@discardableResult
	func handle(_ item: UIApplicationShortcutItem) -> Bool {
		guard item.type == Self.remoteType else { return false }
		remoteRequested = true
		return true
	}

	/// Offered only while a computer is paired: without one there is no screen to show.
	static func update(paired: Bool) {
		UIApplication.shared.shortcutItems = paired
			? [UIApplicationShortcutItem(type: remoteType, localizedTitle: L10n.Remote.title, localizedSubtitle: nil, icon: UIApplicationShortcutIcon(systemImageName: "display"))]
			: []
	}
}

final class AppDelegate: NSObject, UIApplicationDelegate {
	func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
		OrientationLock.mask
	}

	func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
		// Launched from the icon's menu.
		if let item = options.shortcutItem { QuickActions.shared.handle(item) }
		let configuration = UISceneConfiguration(name: nil, sessionRole: session.role)
		configuration.delegateClass = SceneDelegate.self
		return configuration
	}
}

final class SceneDelegate: NSObject, UIWindowSceneDelegate {
	/// Picked from the icon's menu while the app was already running.
	func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem) async -> Bool {
		QuickActions.shared.handle(shortcutItem)
	}
}
