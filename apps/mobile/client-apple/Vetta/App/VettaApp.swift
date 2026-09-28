import SwiftUI
import UIKit
import VettaKit

@main
struct VettaApp: App {
	@State private var notifier: SessionNotifier
	@State private var model: AppModel
	@State private var grace = BackgroundGrace()
	@Environment(\.scenePhase) private var scenePhase
	/// UI tests start from a clean slate, and a permission prompt would stop them.
	private let ephemeral: Bool

	init() {
		let ephemeral = ProcessInfo.processInfo.arguments.contains("-VettaEphemeralStorage")
		let notifier = SessionNotifier()
		self.ephemeral = ephemeral
		_notifier = State(initialValue: notifier)
		_model = State(initialValue: VettaApp.makeModel(ephemeral: ephemeral, signals: ephemeral ? nil : notifier))
	}

	var body: some Scene {
		WindowGroup {
			RootView()
				.environment(model)
				.environment(notifier)
				.onAppear {
					model.start()
					// After the first frame, so warming the keyboard does not hold up launch.
					Task { KeyboardWarmup.run() }
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
					switch phase {
					case .active: grace.end()
					case .background where model.paired && !ephemeral:
						grace.begin()
						BackgroundRefresh.schedule()
					default: break
					}
				}
				.task(id: model.paired) {
					if model.paired, !ephemeral { await notifier.requestAuthorization() }
				}
		}
		.backgroundTask(.appRefresh(BackgroundRefresh.identifier)) { [model] in
			await MainActor.run {
				BackgroundRefresh.schedule()
				// Woken without a window on screen, `onAppear` may not have run.
				model.start()
			}
			await model.refreshInBackground()
		}
	}

	@MainActor
	static func makeModel(ephemeral: Bool, signals: SessionSignals?) -> AppModel {
		let feedback = UINotificationFeedbackGenerator()
		var platform = AppPlatform(
			settings: ephemeral ? MemoryKeyValueStore() : UserDefaultsStore(),
			secrets: ephemeral ? MemoryKeyValueStore() : KeychainStore(),
			cache: ephemeral ? MemorySessionCache() : SQLiteSessionCache(path: SQLiteSessionCache.defaultPath()),
			createTransport: { url, options in WebSocketTransport(url: url, options: options) },
			deviceName: String(UIDevice.current.name.prefix(64))
		)
		platform.onTurnEnd = { feedback.notificationOccurred(.success) }
		platform.signals = signals
		return AppModel(platform: platform)
	}
}
