import SwiftUI
import VettaKit

enum Route: Hashable {
	case newSession
	case session(String)
}

enum AppTab: Hashable {
	case work, settings
}

/// Navigation state shared by every screen.
@Observable
final class Router {
	var tab = AppTab.work
	var workPath: [Route] = []
	/// The pairing screen, opened on purpose from an empty state or Settings.
	var showPairing = false

	func startNewSession() {
		tab = .work
		workPath = [.newSession]
	}

	/// What New Session had when its start failed, put back when it reopens.
	var failedStart: NewSessionStart?

	/// Back to New Session with what was typed, unless the user already left `sessionId`'s chat.
	func returnToNewSession(_ start: NewSessionStart, from sessionId: String) {
		guard workPath == [.session(sessionId)] else { return }
		failedStart = start
		var transaction = Transaction()
		transaction.disablesAnimations = true
		withTransaction(transaction) { workPath = [.newSession] }
	}

	/// Swaps New Session for the chat it just started, so Back goes to the list.
	func openSession(_ sessionId: String) {
		var transaction = Transaction()
		transaction.disablesAnimations = true
		withTransaction(transaction) {
			tab = .work
			workPath = [.session(sessionId)]
		}
	}
}

struct RootView: View {
	@Environment(AppModel.self) private var model
	@State private var router = Router()

	var body: some View {
		TabView(selection: $router.tab) {
			Tab(L10n.Tab.work, systemImage: "tray.full", value: AppTab.work) {
				NavigationStack(path: $router.workPath) {
					WorkView()
						.navigationDestination(for: Route.self) { route in
							switch route {
							case .newSession: NewSessionView()
							case let .session(id): SessionView(sessionId: id)
							}
						}
				}
			}
			.badge(model.count(.waiting))
			.accessibilityIdentifier("tab.work")

			Tab(L10n.Settings.title, systemImage: "gearshape", value: AppTab.settings) {
				NavigationStack {
					SettingsView()
				}
			}
			.accessibilityIdentifier("tab.settings")
		}
		.tint(Theme.ink)
		.environment(router)
		.sheet(isPresented: $router.showPairing, onDismiss: { model.cancelPairing() }) {
			PairView()
				.environment(router)
		}
		// Content fades out under every bar, as on iOS 26; iOS 27 otherwise draws a hard edge.
		// Outside the sheet above so it reaches every page, sheets included.
		.scrollEdgeEffectStyle(.soft, for: .all)
		.alert(model.lastError ?? "", isPresented: Binding(get: { model.lastError != nil }, set: { if !$0 { model.clearError() } })) {
			Button(L10n.Common.confirm, role: .cancel) { model.clearError() }
		}
		.onChange(of: model.paired) { _, paired in
			if !paired { router.workPath.removeAll() }
		}
		#if DEBUG
		// Screenshots of a chat without driving the UI: `-VettaOpenSession <id>` opens it once paired;
		// `-VettaOpenSession new` opens New Session.
		.task(id: model.sessionsLoaded) {
			let arguments = ProcessInfo.processInfo.arguments
			guard model.sessionsLoaded, router.workPath.isEmpty,
			      let index = arguments.firstIndex(of: "-VettaOpenSession"), index + 1 < arguments.count
			else { return }
			let target = arguments[index + 1]
			if target == "new" { router.startNewSession() } else { router.openSession(target) }
		}
		#endif
		.onOpenURL { url in
			guard url.scheme == PairingURI.scheme, url.host == PairingURI.host else { return }
			Task {
				if await model.pairWithCode(url.absoluteString) {
					router.showPairing = false
					model.refreshLink()
				}
			}
		}
	}
}
