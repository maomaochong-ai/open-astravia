import SwiftUI
import VettaKit

enum Route: Hashable {
	/// `projectCwd` is chosen up front; `nil` starts in the desktop's conversations.
	case newSession(projectCwd: String? = nil)
	case session(String)
	case project(String)
	/// The desktop's project-less chats, on the same page a project gets.
	case conversations
	case projects
	case settings
}

/// Navigation state shared by every screen: one stack with Home at its root.
@Observable
final class Router {
	var path: [Route] = []
	/// The pairing screen, opened on purpose from an empty state or Settings.
	var showPairing = false

	func startNewSession() {
		path = [.newSession()]
	}

	/// New Session in a project, over the current page so Back returns to it.
	func startNewSession(in projectCwd: String?) {
		path.append(.newSession(projectCwd: projectCwd))
	}

	/// What New Session had when its start failed, put back when it reopens.
	var failedStart: NewSessionStart?

	/// Back to New Session with what was typed, unless the user already left `sessionId`'s chat.
	func returnToNewSession(_ start: NewSessionStart, from sessionId: String) {
		guard path.last == .session(sessionId) else { return }
		failedStart = start
		withoutAnimation { path[path.count - 1] = .newSession() }
	}

	/// Swaps New Session for the chat it just started, so Back goes to the page New Session was opened from.
	func openSession(_ sessionId: String) {
		withoutAnimation {
			if case .newSession = path.last { path.removeLast() }
			path.append(.session(sessionId))
		}
	}

	private func withoutAnimation(_ change: () -> Void) {
		var transaction = Transaction()
		transaction.disablesAnimations = true
		withTransaction(transaction, change)
	}
}

struct RootView: View {
	@Environment(AppModel.self) private var model
	@State private var router = Router()

	var body: some View {
		NavigationStack(path: $router.path) {
			HomeView()
				.navigationDestination(for: Route.self) { route in
					switch route {
					case let .newSession(projectCwd): NewSessionView(projectCwd: projectCwd)
					case let .session(id): SessionView(sessionId: id)
					case let .project(cwd): ProjectView(cwd: cwd)
					case .conversations: ProjectView(cwd: nil)
					case .projects: ProjectsView()
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
		// Content fades out under every bar, as on iOS 26; iOS 27 otherwise draws a hard edge.
		// Outside the sheet above so it reaches every page, sheets included.
		.scrollEdgeEffectStyle(.soft, for: .all)
		.alert(model.lastError ?? "", isPresented: Binding(get: { model.lastError != nil }, set: { if !$0 { model.clearError() } })) {
			Button(L10n.Common.confirm, role: .cancel) { model.clearError() }
		}
		.onChange(of: model.paired) { _, paired in
			if !paired { router.path.removeAll() }
		}
		#if DEBUG
		// Screenshots of a chat without driving the UI: `-VettaOpenSession <id>` opens it once paired;
		// `-VettaOpenSession new` opens New Session.
		.task(id: model.sessionsLoaded) {
			let arguments = ProcessInfo.processInfo.arguments
			guard model.sessionsLoaded, router.path.isEmpty,
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
