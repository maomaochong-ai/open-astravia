import SwiftUI
import VettaKit

/// What the root shows: one session at a time, New Session when there is none.
enum Slot: Hashable {
	/// `projectCwd` is chosen up front; `nil` starts in the desktop's conversations.
	case newSession(projectCwd: String? = nil)
	case session(String)
}

/// Pages inside the Home drawer.
enum Route: Hashable {
	case project(String)
	case settings
	case board
}

/// Navigation state shared by every screen: the session in the root slot, and
/// Home as a drawer over it with its own stack.
@Observable
final class Router {
	var slot: Slot = .newSession()
	/// Home's pages, kept while the drawer is closed so it reopens where it was left.
	var path: [Route] = []
	var drawerOpen = false
	/// The pairing screen, opened on purpose from an empty state or Settings.
	var showPairing = false

	/// What New Session had when its start failed, put back when it reopens.
	var failedStart: NewSessionStart?

	func openDrawer() {
		dismissKeyboard()
		withAnimation(.snappy) { drawerOpen = true }
	}

	func closeDrawer() {
		withAnimation(.snappy) { drawerOpen = false }
	}

	/// A blank New Session in the slot, starting in `projectCwd`.
	func startNewSession(in projectCwd: String? = nil) {
		fill(.newSession(projectCwd: projectCwd))
	}

	/// Puts `sessionId`'s chat in the slot.
	func show(_ sessionId: String) {
		fill(.session(sessionId))
	}

	/// Back to New Session with what was typed, unless the user already left `sessionId`'s chat.
	func returnToNewSession(_ start: NewSessionStart, from sessionId: String) {
		guard slot == .session(sessionId) else { return }
		failedStart = start
		withoutAnimation { slot = .newSession(projectCwd: start.projectCwd) }
	}

	/// Unpaired: nothing of the old desktop stays on screen.
	func reset() {
		withoutAnimation {
			slot = .newSession()
			path.removeAll()
			drawerOpen = false
		}
	}

	/// The slot changes at once, under the drawer as it slides away.
	private func fill(_ next: Slot) {
		withoutAnimation { slot = next }
		closeDrawer()
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
		HomeDrawer(enabled: model.paired) {
			NavigationStack {
				switch router.slot {
				case let .newSession(projectCwd):
					NewSessionView(projectCwd: projectCwd).id(router.slot)
				case let .session(id):
					SessionView(sessionId: id).id(id)
				}
			}
		} drawer: {
			NavigationStack(path: $router.path) {
				HomeView()
					.navigationDestination(for: Route.self) { route in
						switch route {
						case let .project(cwd): ProjectView(cwd: cwd)
						case .settings: SettingsView()
						case .board: TaskBoardView()
						}
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
			if !paired { router.reset() }
		}
		// The chat in the slot was deleted, here or on the desktop.
		.onChange(of: model.sessions.map(\.id)) { old, new in
			guard case let .session(slotted) = router.slot else { return }
			let id = model.resolve(slotted)
			if old.contains(id), !new.contains(id) { router.startNewSession() }
		}
		#if DEBUG
		// Screenshots of a chat without driving the UI: `-VettaOpenSession <id>` opens it once paired;
		// `-VettaOpenSession new` keeps New Session.
		.task(id: model.sessionsLoaded) {
			let arguments = ProcessInfo.processInfo.arguments
			guard model.sessionsLoaded, router.slot == .newSession(),
			      let index = arguments.firstIndex(of: "-VettaOpenSession"), index + 1 < arguments.count
			else { return }
			let target = arguments[index + 1]
			if target != "new" { router.show(target) }
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
