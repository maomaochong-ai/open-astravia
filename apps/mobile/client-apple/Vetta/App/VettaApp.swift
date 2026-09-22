import SwiftUI
import UIKit
import VettaKit

@main
struct VettaApp: App {
	@State private var model = VettaApp.makeModel()
	@Environment(\.scenePhase) private var scenePhase

	var body: some Scene {
		WindowGroup {
			RootView()
				.environment(model)
				.onAppear {
					model.start()
					#if DEBUG
					// UI tests and simulator demos pair without the system "open in Vetta?" prompt.
					if let index = ProcessInfo.processInfo.arguments.firstIndex(of: "-VettaPairURI"),
					   index + 1 < ProcessInfo.processInfo.arguments.count
					{
						let uri = ProcessInfo.processInfo.arguments[index + 1]
						Task { _ = await model.pairWithCode(uri) }
					}
					#endif
				}
				.onChange(of: scenePhase) { _, phase in
					model.setActive(phase == .active)
				}
		}
	}

	@MainActor
	static func makeModel() -> AppModel {
		let arguments = ProcessInfo.processInfo.arguments
		// UI tests start from a clean slate so the pairing screen is deterministic.
		let ephemeral = arguments.contains("-VettaEphemeralStorage")
		let feedback = UINotificationFeedbackGenerator()
		var platform = AppPlatform(
			settings: ephemeral ? MemoryKeyValueStore() : UserDefaultsStore(),
			secrets: ephemeral ? MemoryKeyValueStore() : KeychainStore(),
			cache: ephemeral ? MemorySessionCache() : SQLiteSessionCache(path: SQLiteSessionCache.defaultPath()),
			createTransport: { url, options in WebSocketTransport(url: url, options: options) },
			deviceName: String(UIDevice.current.name.prefix(64))
		)
		platform.onTurnEnd = { feedback.notificationOccurred(.success) }
		return AppModel(platform: platform)
	}
}
