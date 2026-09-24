import SwiftUI
import VettaKit

/// The project icon, the same on cards, rows and session tags.
let projectSymbol = "folder.badge.gearshape"

/// A session as Home and a project's page list it: when, what, and the tags worth a look.
struct SessionCard: View {
	var session: RemoteSessionSummary
	var conversationCwd: String?
	/// Off on a project's page, where every session is in that project.
	var showsProject = true

	var body: some View {
		let waiting = session.status == .waitingInput
		VStack(alignment: .leading, spacing: 8) {
			HStack {
				Text(TimeFormat.relative(session.updatedAt))
					.font(.subheadline)
					.foregroundStyle(Theme.dim)
				Spacer(minLength: 0)
				Image(systemName: "chevron.right")
					.font(.footnote.weight(.semibold))
					.foregroundStyle(Theme.faint)
			}
			Text(session.title.trimmingCharacters(in: .whitespaces).isEmpty ? L10n.Home.untitled : session.title)
				.font(.headline)
				.foregroundStyle(Theme.ink)
				.lineLimit(1)
			let tags = tags
			if !tags.isEmpty {
				HStack(spacing: 8) {
					ForEach(tags, id: \.self) { SessionTag(kind: $0) }
				}
				.padding(.top, 2)
			}
		}
		.padding(.horizontal, 18)
		.padding(.vertical, 16)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background {
			// Waiting on the user warms the whole card, not just its tag.
			RoundedRectangle(cornerRadius: 22, style: .continuous)
				.fill(Theme.card)
				.overlay {
					if waiting {
						RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Theme.yellow.opacity(0.09))
					}
				}
		}
		.contentShape(.rect(cornerRadius: 22))
		.accessibilityElement(children: .combine)
	}

	private var tags: [SessionTag.Kind] {
		var tags: [SessionTag.Kind] = []
		switch session.status {
		case .waitingInput: tags.append(.waiting)
		case .running: tags.append(.running)
		case .thinking: tags.append(.thinking)
		case .error: tags.append(.error)
		case .idle, .completed, .aborted: break
		}
		if session.pinned { tags.append(.pinned) }
		if showsProject {
			tags.append(session.projectCwd == conversationCwd ? .conversation : .project(session.projectName))
		}
		return tags
	}
}

/// A capsule under a session's title.
struct SessionTag: View {
	enum Kind: Hashable {
		case waiting, running, thinking, error, pinned, conversation
		case project(String)
	}

	var kind: Kind

	var body: some View {
		let look = look
		HStack(spacing: 5) {
			StatusGlyph(kind: kind, symbol: look.symbol)
				.font(.footnote.weight(.bold))
			Text(look.text).lineLimit(1)
		}
		.font(.subheadline.weight(look.tint == nil ? .regular : .semibold))
		.foregroundStyle(look.tint ?? Theme.ink2)
		.padding(.horizontal, 10)
		.padding(.vertical, 5)
		.background((look.tint ?? Theme.faint).opacity(0.16), in: .capsule)
	}

	private var look: (symbol: String, text: String, tint: Color?) {
		switch kind {
		case .waiting: ("questionmark", L10n.Home.statusWaiting, Theme.yellow)
		case .running: ("arrow.triangle.2.circlepath", L10n.Home.statusRunning, Theme.blue)
		case .thinking: ("arrow.triangle.2.circlepath", L10n.Home.statusThinking, Theme.blue)
		case .error: ("exclamationmark", L10n.Home.statusError, Theme.red)
		case .pinned: ("pin.fill", L10n.Session.pinned, Theme.yellow)
		case .conversation: ("bubble.left", L10n.Home.conversation, nil)
		case let .project(name): (projectSymbol, name, nil)
		}
	}
}

/// A status symbol that moves while the state it names is live: working turns, waiting breathes.
struct StatusGlyph: View {
	var kind: SessionTag.Kind
	var symbol: String

	init(kind: SessionTag.Kind, symbol: String) {
		self.kind = kind
		self.symbol = symbol
	}

	init(status: RemoteSessionStatus) {
		switch status {
		case .waitingInput: self.init(kind: .waiting, symbol: "questionmark")
		case .running: self.init(kind: .running, symbol: "arrow.triangle.2.circlepath")
		case .thinking: self.init(kind: .thinking, symbol: "arrow.triangle.2.circlepath")
		case .error: self.init(kind: .error, symbol: "exclamationmark")
		case .idle, .completed, .aborted: self.init(kind: .conversation, symbol: "checkmark")
		}
	}

	var body: some View {
		let image = Image(systemName: symbol)
		switch kind {
		case .running, .thinking: image.symbolEffect(.rotate, options: .repeat(.continuous))
		case .waiting: image.symbolEffect(.breathe, options: .repeat(.continuous))
		default: image
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
			Button { router.path.append(.session(session.id)) } label: {
				SessionCard(session: session, conversationCwd: model.conversationCwd, showsProject: showsProject)
			}
			.buttonStyle(.plain)
			.accessibilityIdentifier("session.\(session.id)")
			.listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
			.listRowSeparator(.hidden)
			.listRowBackground(Color.clear)
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

/// The floating Liquid Glass button that starts a session.
struct NewSessionButton: View {
	var action: () -> Void

	var body: some View {
		Button(action: action) {
			Label(L10n.NewSession.title, systemImage: "plus")
				.font(.headline)
				.foregroundStyle(Theme.ink)
				.padding(.horizontal, 30)
				.frame(height: 56)
				.contentShape(.capsule)
		}
		.buttonStyle(.plain)
		.glassEffect(.regular.interactive(), in: .capsule)
		.padding(.bottom, 4)
		.accessibilityIdentifier("home.newSession")
	}
}

/// How far a list has scrolled, read only by the backdrop so scrolling redraws nothing else.
@Observable
final class ScrollDepth {
	var offset: CGFloat = 0

	/// Past the glow nothing changes; whole points are enough for a gradient.
	/// Runs on SwiftUI's render thread on device, so it must stay nonisolated.
	nonisolated static func read(_ geometry: ScrollGeometry) -> CGFloat {
		min(max(geometry.contentOffset.y + geometry.contentInsets.top, 0), glowHeight).rounded()
	}

	nonisolated static let glowHeight: CGFloat = 420
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
