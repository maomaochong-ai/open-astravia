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

/// Mail-style category row: one coloured segment per status, the chosen one
/// spelled out, then on Home menu chips for kind and project.
struct FilterBar: View {
	@Environment(AppModel.self) private var model
	@Binding var filter: SessionFilter
	/// Off on a project's page, which only filters by status.
	var showsKind = true

	var body: some View {
		let projects = SessionFilter.projects(in: model.sessions, conversationCwd: model.conversationCwd)
		ScrollView(.horizontal) {
			HStack(spacing: 8) {
				if filter.status != nil || (showsKind && filter.isActive) {
					Button {
						withAnimation(.snappy) {
							if showsKind { filter = SessionFilter() } else { filter.status = nil }
						}
					} label: {
						Image(systemName: "xmark")
							.font(.subheadline.weight(.bold))
							.foregroundStyle(Theme.ink2)
							.frame(width: FilterMetrics.height, height: FilterMetrics.height)
							.background(Theme.card2, in: .circle)
					}
					.buttonStyle(.plain)
					.accessibilityLabel(L10n.Home.clearFilters)
					.accessibilityIdentifier("filter.clearChip")
					.transition(.move(edge: .leading).combined(with: .opacity))
				}
				StatusSegment(
					title: L10n.Home.statusAll, symbol: "tray.fill", tint: Theme.pill, ink: Theme.pillInk,
					selected: filter.status == nil, alwaysNamed: true, identifier: "filter.status.all"
				) { filter.status = nil }
				ForEach(SessionStatusGroup.allCases, id: \.self) { group in
					let look = Self.look(group)
					StatusSegment(
						title: L10n.Home.group(group), symbol: look.symbol, tint: look.tint, ink: look.ink,
						count: group == .waiting ? model.count(.waiting) : 0,
						selected: filter.status == group, identifier: "filter.status.\(group)"
					) { filter.status = group }
				}
				if showsKind {
					FilterChip(
						title: kindTitle,
						sizedFor: [L10n.Home.kindAll, L10n.Home.kindConversation, L10n.Home.kindProject],
						active: filter.kind != nil,
						identifier: "filter.kind"
					) {
						Picker(L10n.Home.filterKind, selection: $filter.kind.animation(.snappy)) {
							Text(L10n.Home.kindAll).tag(SessionKind?.none)
							Text(L10n.Home.kindConversation).tag(Optional(SessionKind.conversation))
							Text(L10n.Home.kindProject).tag(Optional(SessionKind.project))
						}
					}
					if filter.kind == .project {
						FilterChip(
							title: projects.first { $0.cwd == filter.projectCwd }?.name ?? L10n.Home.projectAll,
							sizedFor: [L10n.Home.projectAll] + projects.map(\.name),
							active: filter.projectCwd != nil,
							identifier: "filter.project"
						) {
							Picker(L10n.Home.filterProject, selection: $filter.projectCwd.animation(.snappy)) {
								Text(L10n.Home.projectAll).tag(String?.none)
								ForEach(projects, id: \.cwd) { project in
									Text("\(project.name)  \(project.count)").tag(Optional(project.cwd))
								}
							}
						}
						.transition(.move(edge: .leading).combined(with: .opacity))
					}
				}
			}
			.padding(.horizontal, 16)
		}
		.scrollIndicators(.hidden)
		.scrollClipDisabled()
		.sensoryFeedback(.selection, trigger: filter)
	}

	/// Same colours and glyphs as the session tags, so a segment reads as "sessions like these".
	private static func look(_ group: SessionStatusGroup) -> (symbol: String, tint: Color, ink: Color) {
		switch group {
		case .waiting: ("questionmark", Theme.yellow, .black)
		case .processing: ("arrow.triangle.2.circlepath", Theme.blue, .white)
		case .done: ("checkmark", Theme.green, .white)
		}
	}

	private var kindTitle: String {
		switch filter.kind {
		case nil: L10n.Home.kindAll
		case .conversation: L10n.Home.kindConversation
		case .project: L10n.Home.kindProject
		}
	}
}

private enum FilterMetrics {
	static let height: CGFloat = 44
}

/// A status category: an icon in its colour on grey, or filled with its colour and named when chosen.
private struct StatusSegment: View {
	var title: String
	var symbol: String
	var tint: Color
	var ink: Color
	var count = 0
	var selected: Bool
	/// "All" keeps its name either way, as in the design.
	var alwaysNamed = false
	var identifier: String
	var select: () -> Void

	var body: some View {
		let named = selected || alwaysNamed
		Button {
			withAnimation(.snappy) { select() }
		} label: {
			HStack(spacing: 6) {
				Image(systemName: symbol).fontWeight(.bold)
				if named {
					Text(title).lineLimit(1)
				} else if count > 0 {
					Text("\(count)").monospacedDigit()
				}
			}
			.font(.subheadline.weight(.semibold))
			.foregroundStyle(selected ? ink : alwaysNamed ? Theme.ink2 : tint)
			.padding(.horizontal, named ? 18 : 0)
			.frame(minWidth: 64, minHeight: FilterMetrics.height)
			.background(selected ? tint : Theme.card2, in: .capsule)
			.contentShape(.capsule)
		}
		.buttonStyle(.plain)
		.accessibilityLabel(title)
		.accessibilityValue(count > 0 ? "\(count)" : "")
		.accessibilityAddTraits(selected ? .isSelected : [])
		.accessibilityIdentifier(identifier)
	}
}

/// A menu chip whose width fits its widest option, not the current one: on iOS 26
/// the closing menu shrinks back into the label's old frame, so a label that
/// resized on selection would jump once the menu had gone.
private struct FilterChip<Content: View>: View {
	var title: String
	var sizedFor: [String]
	var active: Bool
	var identifier: String
	@ViewBuilder var content: () -> Content

	var body: some View {
		Menu {
			content()
		} label: {
			HStack(spacing: 5) {
				ZStack(alignment: .leading) {
					ForEach(Array(Set(sizedFor)), id: \.self) { Text($0).hidden() }
					Text(title)
				}
				.lineLimit(1)
				.frame(maxWidth: 160, alignment: .leading)
				Image(systemName: "chevron.down").font(.caption2.weight(.bold))
			}
			.font(.subheadline.weight(.semibold))
			.foregroundStyle(active ? Theme.pillInk : Theme.ink2)
			.padding(.horizontal, 18)
			.frame(minHeight: FilterMetrics.height)
			.background(active ? Theme.pill : Theme.card2, in: .capsule)
			.contentShape(.capsule)
		}
		.buttonStyle(.plain)
		.accessibilityIdentifier(identifier)
	}
}

/// The session cards of a list, with the swipe that pins or deletes; the
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
			// Swiping right; delete asks first since it removes the session on the desktop too.
			.swipeActions(edge: .leading, allowsFullSwipe: false) {
				Button {
					Task { await model.setPinned(session.id, !session.pinned) }
				} label: {
					Label(session.pinned ? L10n.Session.unpin : L10n.Session.pin, systemImage: session.pinned ? "pin.slash.fill" : "pin.fill")
				}
				.tint(Theme.yellow)
				Button {
					deleting = session
				} label: {
					Label(L10n.Session.delete, systemImage: "trash.fill")
				}
				.tint(Theme.red)
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
	/// Where the filter header is and where it pins, in global coordinates.
	var headerY: CGFloat = .infinity
	var pinTop: CGFloat = 0

	var pinned: Bool { headerY <= pinTop + 1 }

	// These run on SwiftUI's render thread on device, so they must stay nonisolated.

	/// Past the glow nothing changes; whole points are enough for a gradient.
	nonisolated static func read(_ geometry: ScrollGeometry) -> CGFloat {
		min(max(geometry.contentOffset.y + geometry.contentInsets.top, 0), glowHeight).rounded()
	}

	/// The top of the list's visible content: where a section header pins.
	nonisolated static func contentTop(_ proxy: GeometryProxy) -> CGFloat {
		(proxy.frame(in: .global).minY + proxy.safeAreaInsets.top).rounded()
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
			.onGeometryChange(for: CGFloat.self, of: ScrollDepth.contentTop) { depth.pinTop = $0 }
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
