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
	/// The pairing screen opened on purpose (rescan) while a desktop is already paired.
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
		.fullScreenCover(isPresented: Binding(get: { model.ready && !model.paired }, set: { _ in })) {
			PairView()
				.environment(router)
		}
		.sheet(isPresented: Binding(get: { router.showPairing && model.paired }, set: { router.showPairing = $0 })) {
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
