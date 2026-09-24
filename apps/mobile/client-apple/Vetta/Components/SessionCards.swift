import SwiftUI
import VettaKit

/// The project icon, on project rows and session badges.
let projectSymbol = "folder.badge.gearshape"

/// A session as Home and a project's page list it, on one line: a pin, the title, then at
/// the far right its project as a badge and a status glyph while it needs a look.
/// Conversations name no project, and a project's own page leaves it out.
struct SessionCard: View {
	var session: RemoteSessionSummary
	var conversationCwd: String?
	/// Off on a project's page, where every session is in that project.
	var showsProject = true

	private var title: String {
		session.title.trimmingCharacters(in: .whitespaces).isEmpty ? L10n.Home.untitled : session.title
	}

	private var project: String? {
		showsProject && session.projectCwd != conversationCwd ? session.projectName : nil
	}

	var body: some View {
		let status = StatusGlyph(status: session.status)
		HStack(spacing: 8) {
			if session.pinned {
				Image(systemName: "pin.fill")
					.font(.caption)
					.foregroundStyle(Theme.yellow)
			}
			Text(title)
				.font(.body.weight(.medium))
				.foregroundStyle(Theme.ink)
				.lineLimit(1)
			Spacer(minLength: 8)
			if let project {
				HStack(spacing: 4) {
					Image(systemName: projectSymbol).font(.caption2.weight(.semibold))
					Text(project).lineLimit(1)
				}
				.font(.caption.weight(.medium))
				.foregroundStyle(Theme.ink2)
				.padding(.horizontal, 8)
				.padding(.vertical, 4)
				.background(Theme.faint.opacity(0.16), in: .capsule)
				// Always whole; the title is what gives way.
				.fixedSize()
			}
			if let status {
				status.font(.footnote.weight(.bold))
			}
		}
		.padding(.horizontal, 20)
		.padding(.vertical, 13)
		.frame(maxWidth: .infinity, alignment: .leading)
		.contentShape(.rect)
		.accessibilityElement(children: .ignore)
		.accessibilityLabel(accessibilityText(status))
	}

	private func accessibilityText(_ status: StatusGlyph?) -> String {
		var parts = [title]
		if let status { parts.append(status.label) }
		if session.pinned { parts.append(L10n.Session.pinned) }
		if let project { parts.append(project) }
		return parts.joined(separator: ", ")
	}
}

/// A session's state as a coloured symbol, only while it needs a look; it moves while the
/// state is live: working turns, waiting breathes.
struct StatusGlyph: View {
	let status: RemoteSessionStatus

	/// `nil` for a finished or idle session, which needs no mark.
	init?(status: RemoteSessionStatus) {
		switch status {
		case .waitingInput, .running, .thinking, .error: self.status = status
		case .idle, .completed, .aborted: return nil
		}
	}

	var label: String {
		switch status {
		case .waitingInput: L10n.Home.statusWaiting
		case .running: L10n.Home.statusRunning
		case .thinking: L10n.Home.statusThinking
		default: L10n.Home.statusError
		}
	}

	var body: some View {
		switch status {
		case .waitingInput:
			Image(systemName: "questionmark").foregroundStyle(Theme.yellow).symbolEffect(.breathe, options: .repeat(.continuous))
		case .running, .thinking:
			Image(systemName: "arrow.triangle.2.circlepath").foregroundStyle(Theme.blue).symbolEffect(.rotate, options: .repeat(.continuous))
		default:
			Image(systemName: "exclamationmark").foregroundStyle(Theme.red)
		}
	}
}

/// The list's header: "Tasks", then a status menu and, on Home, the project sheet.
/// Each icon fills in while it narrows the list, so a filtered list never passes for the whole.
struct FilterBar: View {
	@Environment(AppModel.self) private var model
	@Binding var filter: SessionFilter
	/// Off on a project's page, which only filters by status.
	var showsProject = true
	@State private var pickingProject = false

	var body: some View {
		HStack(spacing: 10) {
			Text(L10n.Home.tasks)
				.font(.headline)
				.foregroundStyle(Theme.dim)
				.accessibilityAddTraits(.isHeader)
			Spacer()
			Menu {
				Picker(L10n.Home.filterStatus, selection: $filter.status.animation(.snappy)) {
					Label(L10n.Home.statusAll, systemImage: "tray").tag(SessionStatusGroup?.none)
					ForEach(SessionStatusGroup.allCases, id: \.self) { group in
						Label(title(group), systemImage: Self.symbol(group)).tag(Optional(group))
					}
				}
			} label: {
				FilterIcon(symbol: "line.3.horizontal.decrease", active: filter.status != nil)
			}
			.buttonStyle(.plain)
			.accessibilityLabel(L10n.Home.filterStatus)
			.accessibilityValue(filter.status.map(L10n.Home.group) ?? L10n.Home.statusAll)
			.accessibilityIdentifier("filter.status")
			if showsProject {
				Button { pickingProject = true } label: {
					FilterIcon(symbol: "folder", active: filter.scope != .all)
				}
				.buttonStyle(.plain)
				.accessibilityLabel(L10n.Home.pickProject)
				.accessibilityIdentifier("filter.project")
				.sheet(isPresented: $pickingProject) {
					ProjectSheet(selection: filter.scope, offersAll: true) { scope in
						withAnimation(.snappy) { filter.scope = scope }
					}
				}
			}
		}
		.padding(.horizontal, 20)
		.sensoryFeedback(.selection, trigger: filter)
	}

	/// Waiting sessions carry their count, as the one group that needs the user.
	private func title(_ group: SessionStatusGroup) -> String {
		let count = group == .waiting ? model.count(.waiting) : 0
		return count > 0 ? "\(L10n.Home.group(group))  \(count)" : L10n.Home.group(group)
	}

	private static func symbol(_ group: SessionStatusGroup) -> String {
		switch group {
		case .waiting: "questionmark.circle"
		case .processing: "arrow.triangle.2.circlepath"
		case .done: "checkmark.circle"
		}
	}
}

/// One of the header's filter icons: plain while it lets everything through, filled while it narrows.
private struct FilterIcon: View {
	var symbol: String
	var active: Bool

	var body: some View {
		Image(systemName: symbol)
			.font(.body.weight(.semibold))
			.foregroundStyle(active ? Theme.pillInk : Theme.ink2)
			.frame(width: 38, height: 38)
			.background(active ? Theme.pill : Theme.card2, in: .circle)
			.contentShape(.circle)
			.animation(.snappy, value: active)
	}
}

/// The session cards of a list, with the long-press menu that pins or deletes; the
/// delete confirmation hangs off the list through `sessionDeleteDialog`.
struct SessionCardRows: View {
	@Environment(AppModel.self) private var model
	@Environment(Router.self) private var router
	var rows: [RemoteSessionSummary]
	var showsProject = true
	@Binding var deleting: RemoteSessionSummary?

	var body: some View {
		ForEach(rows) { session in
			Button { router.show(session.id) } label: {
				SessionCard(session: session, conversationCwd: model.conversationCwd, showsProject: showsProject)
			}
			.buttonStyle(.plain)
			.accessibilityIdentifier("session.\(session.id)")
			.listRowInsets(EdgeInsets())
			.listRowSeparator(.hidden)
			// Waiting on the user warms the whole row, not just its tag.
			.listRowBackground(session.status == .waitingInput ? Theme.yellow.opacity(0.09) : Color.clear)
			// A long press; delete asks first since it removes the session on the desktop too.
			.contextMenu {
				Button(session.pinned ? L10n.Session.unpin : L10n.Session.pin, systemImage: session.pinned ? "pin.slash" : "pin") {
					Task { await model.setPinned(session.id, !session.pinned) }
				}
				Button(L10n.Session.delete, systemImage: "trash", role: .destructive) {
					deleting = session
				}
			}
		}
	}
}

extension View {
	func sessionDeleteDialog(_ deleting: Binding<RemoteSessionSummary?>, model: AppModel) -> some View {
		confirmationDialog(
			L10n.Session.deleteTitle,
			isPresented: Binding(get: { deleting.wrappedValue != nil }, set: { if !$0 { deleting.wrappedValue = nil } }),
			titleVisibility: .visible,
			presenting: deleting.wrappedValue
		) { session in
			Button(L10n.Session.delete, role: .destructive) {
				Task { await model.deleteSession(session.id) }
			}
			Button(L10n.Common.cancel, role: .cancel) {}
		} message: { _ in
			Text(L10n.Session.deleteMessage)
		}
	}

	/// A list row that is only layout: no inset, line or background of its own.
	func bareRow(top: CGFloat = 0, bottom: CGFloat = 0) -> some View {
		listRowInsets(EdgeInsets(top: top, leading: 0, bottom: bottom, trailing: 0))
			.listRowSeparator(.hidden)
			.listRowBackground(Color.clear)
	}
}

/// The floating Liquid Glass button that starts a session, tinted white with black ink in both appearances.
struct NewSessionButton: View {
	var action: () -> Void

	var body: some View {
		Button(action: action) {
			Label(L10n.NewSession.title, systemImage: "plus")
				.font(.headline)
				.foregroundStyle(.black)
				.padding(.horizontal, 30)
				.frame(height: 56)
				.contentShape(.capsule)
		}
		.buttonStyle(.plain)
		.glassEffect(.regular.tint(.white).interactive(), in: .capsule)
		.padding(.bottom, 4)
		.accessibilityIdentifier("home.newSession")
	}
}

/// Scroll-driven state read only by the backdrop and the pinned filter's fade,
/// so scrolling redraws nothing else.
@Observable
final class ScrollDepth {
	var offset: CGFloat = 0
	/// Where the filter header is, in global coordinates.
	var headerY: CGFloat = .infinity
	/// Where a section header pins, in global coordinates: the scroll view's top inset, which
	/// counts every bar laid over the list. The lists run under those bars from the top of the
	/// screen, so the inset is the position; their layout frame starts below the bars and
	/// adding it would count them twice.
	var pinTop: CGFloat = 0

	/// Only once the list has scrolled: at rest the inset can already count a large title the
	/// header sits right under (a page pushed from another large-title page), and the fade
	/// would then cover that title.
	var pinned: Bool { offset > 0 && headerY <= pinTop + 1 }

	// These run on SwiftUI's render thread on device, so they must stay nonisolated.

	/// Past the glow nothing changes; whole points are enough for a gradient.
	nonisolated static func read(_ geometry: ScrollGeometry) -> CGFloat {
		min(max(geometry.contentOffset.y + geometry.contentInsets.top, 0), glowHeight).rounded()
	}

	nonisolated static func insetTop(_ geometry: ScrollGeometry) -> CGFloat {
		geometry.contentInsets.top.rounded()
	}

	nonisolated static func top(_ proxy: GeometryProxy) -> CGFloat {
		proxy.frame(in: .global).minY.rounded()
	}

	nonisolated static let glowHeight: CGFloat = 420
}

extension View {
	/// Feeds `depth` from the list this is applied to.
	func trackScrollDepth(_ depth: ScrollDepth) -> some View {
		onScrollGeometryChange(for: CGFloat.self, of: ScrollDepth.read) { _, offset in depth.offset = offset }
			.onScrollGeometryChange(for: CGFloat.self, of: ScrollDepth.insetTop) { _, inset in depth.pinTop = inset }
	}

	/// A status filter as a list's sticky section header. Once pinned, the page
	/// colour behind it fades out downward so the cards slide away under it;
	/// before that it has no background at all.
	func pinnedFilterHeader(_ depth: ScrollDepth) -> some View {
		padding(.vertical, 10)
			.frame(maxWidth: .infinity)
			.background { PinnedFade(depth: depth) }
			.onGeometryChange(for: CGFloat.self, of: ScrollDepth.top) { depth.headerY = $0 }
			.listRowInsets(EdgeInsets())
	}
}

private struct PinnedFade: View {
	var depth: ScrollDepth

	var body: some View {
		LinearGradient(
			stops: [
				.init(color: Theme.page, location: 0),
				.init(color: Theme.page, location: 0.55),
				.init(color: Theme.page.opacity(0), location: 1),
			],
			startPoint: .top,
			endPoint: .bottom
		)
		// Up over the status bar, and down past the chips for the fade.
		.padding(.top, -depth.pinTop)
		.padding(.bottom, -40)
		.opacity(depth.pinned ? 1 : 0)
		.animation(.easeOut(duration: 0.15), value: depth.pinned)
		.allowsHitTesting(false)
	}
}

/// The page colour with a soft static light at the top that scrolls away with the content.
struct GlowBackdrop: View {
	var depth: ScrollDepth

	var body: some View {
		Theme.page
			.overlay(alignment: .top) {
				RadialGradient(colors: [Theme.glow, Theme.glow.opacity(0)], center: .top, startRadius: 0, endRadius: ScrollDepth.glowHeight)
					.frame(height: ScrollDepth.glowHeight)
					.scaleEffect(x: 1.6, y: 1, anchor: .top)
					.offset(y: -depth.offset)
			}
			.ignoresSafeArea()
	}
}

/// UIKit's own search bar, for a search field that sits inside the page rather than in a navigation bar.
struct NativeSearchBar: UIViewRepresentable {
	@Binding var text: String
	/// True from the first tap until Cancel, or until the keyboard goes away with nothing typed.
	@Binding var active: Bool
	var placeholder: String
	/// Takes the keyboard as soon as it appears.
	var focused = false

	func makeUIView(context: Context) -> UISearchBar {
		let bar = UISearchBar()
		bar.searchBarStyle = .minimal
		bar.autocorrectionType = .no
		bar.returnKeyType = .search
		bar.delegate = context.coordinator
		bar.accessibilityIdentifier = "home.search"
		bar.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
		if focused { DispatchQueue.main.async { bar.becomeFirstResponder() } }
		return bar
	}

	func updateUIView(_ bar: UISearchBar, context: Context) {
		context.coordinator.parent = self
		if bar.text != text { bar.text = text }
		bar.placeholder = placeholder
		if bar.showsCancelButton != active { bar.setShowsCancelButton(active, animated: true) }
		if !active, bar.isFirstResponder { bar.resignFirstResponder() }
	}

	func sizeThatFits(_ proposal: ProposedViewSize, uiView: UISearchBar, context: Context) -> CGSize? {
		CGSize(width: proposal.width ?? 320, height: uiView.intrinsicContentSize.height)
	}

	func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

	final class Coordinator: NSObject, UISearchBarDelegate {
		var parent: NativeSearchBar

		init(parent: NativeSearchBar) { self.parent = parent }

		func searchBarTextDidBeginEditing(_ searchBar: UISearchBar) {
			parent.active = true
		}

		func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) {
			parent.text = searchText
		}

		func searchBarSearchButtonClicked(_ searchBar: UISearchBar) {
			searchBar.resignFirstResponder()
		}

		func searchBarTextDidEndEditing(_ searchBar: UISearchBar) {
			if parent.text.isEmpty { parent.active = false }
		}

		func searchBarCancelButtonClicked(_ searchBar: UISearchBar) {
			parent.text = ""
			parent.active = false
			searchBar.resignFirstResponder()
		}
	}
}
