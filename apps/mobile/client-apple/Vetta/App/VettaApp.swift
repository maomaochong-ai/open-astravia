import SwiftUI
import UIKit
import VettaKit
import VettaRTC

@main
struct VettaApp: App {
	@UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
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
		// Fields SwiftUI's tint does not reach, such as an alert's, get the blue caret too.
		UITextField.appearance().tintColor = Theme.selectionUI
		UITextView.appearance().tintColor = Theme.selectionUI
		_notifier = State(initialValue: notifier)
		let model = VettaApp.makeModel(ephemeral: ephemeral, signals: ephemeral ? nil : notifier)
		_model = State(initialValue: model)
		// Here rather than in the view: a tap on the Live Activity may launch the app with no window.
		AnswerQuestionHandler.run = { sessionId, requestId, question, choice in
			notifier.answering(sessionId, choice: choice)
			if await !model.answer(sessionId, requestId: requestId, question: question, choice: choice) {
				notifier.answerFailed()
			}
		}
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
		let impact = UIImpactFeedbackGenerator(style: .light)
		platform.onTurnStart = { impact.impactOccurred() }
		platform.onTurnEnd = { feedback.notificationOccurred(.success) }
		// Once on the LAN or relay, the link moves to the WebRTC control channel through the
		// relay's viewer signaling; the same session carries the screen (ADR-0140).
		platform.configureManager = { options in
			guard let relay = options.desktop.relayBaseUrl, !relay.isEmpty else { return }
			options.p2pTarget = PairingURI.desktopViewerUrl(relayBaseUrl: relay, pairingId: options.desktop.pairingId, mobileSecret: options.desktop.mobileSecret)
			options.createP2pTransport = { RemoteDesktopSessions.shared.transport(for: $0) }
		}
		platform.signals = signals
		return AppModel(platform: platform)
	}
}
