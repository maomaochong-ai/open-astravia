import SwiftUI
import VettaKit

enum Route: Hashable {
	case session(String)
}

enum AppTab: Hashable {
	case work, settings, newSession
}

/// Navigation state shared by every screen.
@Observable
final class Router {
	var tab = AppTab.work
	var workPath: [Route] = []
	/// The pairing screen, opened on purpose from an empty state or Settings.
	var showPairing = false

	/// Lands straight in a session's chat, filed under Work, with no list flashing by.
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

			// The search role is the only way to get the separate round button at the trailing end.
			Tab(L10n.NewSession.title, systemImage: "square.and.pencil", value: AppTab.newSession, role: .search) {
				NavigationStack {
					NewSessionView()
				}
			}
			.accessibilityIdentifier("tab.newSession")
		}
		.tint(Theme.ink)
		.environment(router)
		.sheet(isPresented: $router.showPairing, onDismiss: { model.cancelPairing() }) {
			PairView()
				.environment(router)
		}
		.alert(model.lastError ?? "", isPresented: Binding(get: { model.lastError != nil }, set: { if !$0 { model.clearError() } })) {
			Button(L10n.Common.confirm, role: .cancel) { model.clearError() }
		}
		.onChange(of: model.paired) { _, paired in
			if !paired { router.workPath.removeAll() }
		}
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
