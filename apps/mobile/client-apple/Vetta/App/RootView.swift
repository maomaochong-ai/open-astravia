import SwiftUI
import VettaKit

enum Route: Hashable {
	case session(String)
	case settings
}

/// Navigation state shared by every screen.
@Observable
final class Router {
	var path: [Route] = []
	/// The pairing screen, opened on purpose from the home guide or a rescan.
	var showPairing = false
}

struct RootView: View {
	@Environment(AppModel.self) private var model
	@State private var router = Router()

	var body: some View {
		NavigationStack(path: $router.path) {
			HomeView()
				.navigationDestination(for: Route.self) { route in
					switch route {
					case let .session(id): SessionView(sessionId: id)
					case .settings: SettingsView()
					}
				}
		}
		.tint(Theme.ink)
		.environment(router)
		.sheet(isPresented: $router.showPairing, onDismiss: { model.cancelPairing() }) {
			PairView()
				.environment(router)
		}
		.onChange(of: model.paired) { _, paired in
			if !paired { router.path.removeAll() }
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
