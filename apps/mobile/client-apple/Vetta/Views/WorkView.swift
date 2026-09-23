import SwiftUI
import VettaKit

struct WorkView: View {
	@Environment(AppModel.self) private var model
	@Environment(Router.self) private var router
	@State private var filter = SessionFilter()
	/// True once the list has scrolled past the large title and the small centred one takes over.
	@State private var titleCollapsed = false
	/// The session whose delete is waiting on confirmation.
	@State private var deleting: RemoteSessionSummary?

	var body: some View {
		Group {
			if model.paired {
				sessionList
			} else {
				// Nothing to mirror until a desktop is paired.
				UnpairedView().opacity(model.ready ? 1 : 0)
			}
		}
		.navigationTitle(L10n.Home.title)
		.navigationBarTitleDisplayMode(.large)
		.toolbar {
			if model.paired {
				ToolbarItem(placement: .largeTitle) {
					HStack(spacing: 10) {
						Text(L10n.Home.title).font(.largeTitle.bold())
						// Online is the normal case, so the large title only speaks up when it is not.
						if LinkIndicator(model.link) != .online { LinkStatusButton() }
						Spacer(minLength: 0)
					}
				}
				// Tab roles (.search, iOS 27's .prominent) are destinations that keep the tab bar,
				// so starting a session is a toolbar action instead.
				ToolbarItem(placement: .topBarTrailing) {
					Button { router.startNewSession() } label: {
						Image(systemName: "square.and.pencil")
					}
					.accessibilityLabel(L10n.NewSession.title)
					.accessibilityIdentifier("work.newSession")
				}
				ToolbarItem(placement: .principal) {
					// The system shows a principal item beside a large title too, so hand over on scroll.
					if titleCollapsed {
						HStack(spacing: 6) {
							Text(L10n.Home.title).font(.headline)
							LinkStatusButton(compact: true)
						}
						.transition(.opacity)
					}
				}
			}
		}
	}

	private var sessionList: some View {
		let rows = filter.apply(model.sessions, conversationCwd: model.conversationCwd)
		return List {
			FilterBar(filter: $filter)
				.listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 8, trailing: 0))
				.listRowSeparator(.hidden)
			ForEach(rows) { session in
				NavigationLink(value: Route.session(session.id)) {
					SessionRow(session: session, conversationCwd: model.conversationCwd)
				}
				.accessibilityIdentifier("session.\(session.id)")
				// The filter bar above has no line under it, so the first row has none on top either.
				.listRowSeparator(session.id == rows.first?.id ? .hidden : .automatic, edges: .top)
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
		.listStyle(.plain)
		// Pinning moves the row to the top; let it travel there.
		.animation(.snappy, value: rows.map(\.id))
		.confirmationDialog(
			L10n.Session.deleteTitle,
			isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
			titleVisibility: .visible,
			presenting: deleting
		) { session in
			Button(L10n.Session.delete, role: .destructive) {
				Task { await model.deleteSession(session.id) }
			}
			Button(L10n.Common.cancel, role: .cancel) {}
		} message: { _ in
			Text(L10n.Session.deleteMessage)
		}
		.onScrollGeometryChange(for: Bool.self, of: Self.scrolledPastTitle) { _, collapsed in
			withAnimation(.easeInOut(duration: 0.15)) { titleCollapsed = collapsed }
		}
		.overlay {
			if rows.isEmpty, model.sessionsLoaded || LinkIndicator(model.link) == .offline {
				emptyState
			}
		}
		.refreshable { await model.refreshSessions() }
	}

	/// Only how far the content moved counts: the top inset itself changes with
	/// pull-to-refresh and transitions, and must not collapse the title at the top.
	/// SwiftUI calls this on its render thread on device, so it must not inherit the
	/// view's main-actor isolation: a main-actor closure traps there (EXC_BREAKPOINT).
	private nonisolated static func scrolledPastTitle(_ geometry: ScrollGeometry) -> Bool {
		geometry.contentOffset.y + geometry.contentInsets.top > 40
	}

	@ViewBuilder
	private var emptyState: some View {
		if model.sessions.isEmpty {
			ContentUnavailableView {
				Label(L10n.Home.empty, systemImage: "tray")
			} description: {
				Text(L10n.Home.emptyDescription)
			} actions: {
				Button(L10n.NewSession.title) { router.startNewSession() }
			}
		} else {
			ContentUnavailableView {
				Label(L10n.Home.emptyFiltered, systemImage: "line.3.horizontal.decrease.circle")
			} description: {
				Text(L10n.Home.emptyFilteredDescription)
			} actions: {
				Button(L10n.Home.clearFilters) { withAnimation { filter = SessionFilter() } }
					.accessibilityIdentifier("filter.clear")
			}
		}
	}
}

/// Mail-style category row above the list: one coloured segment per status,
/// the chosen one spelled out, then menu chips for kind and project.
private struct FilterBar: View {
	@Environment(AppModel.self) private var model
	@Binding var filter: SessionFilter

	var body: some View {
		let projects = SessionFilter.projects(in: model.sessions, conversationCwd: model.conversationCwd)
		ScrollView(.horizontal) {
			HStack(spacing: 8) {
				if filter.isActive {
					Button {
						withAnimation(.snappy) { filter = SessionFilter() }
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
					selected: filter.status == nil, identifier: "filter.status.all"
				) { filter.status = nil }
				ForEach(SessionStatusGroup.allCases, id: \.self) { group in
					let look = Self.look(group)
					StatusSegment(
						title: L10n.Home.group(group), symbol: look.symbol, tint: look.tint, ink: look.ink,
						count: group == .waiting ? model.count(.waiting) : 0,
						selected: filter.status == group, identifier: "filter.status.\(group)"
					) { filter.status = group }
				}
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
			.padding(.horizontal, 16)
		}
		.scrollIndicators(.hidden)
		.scrollClipDisabled()
		.sensoryFeedback(.selection, trigger: filter)
	}

	/// Same colours and glyphs as the row avatars, so a segment reads as "rows like these".
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
	static let height: CGFloat = 38
}

/// A status category: an icon in its colour on grey, or filled with its colour and named when chosen.
private struct StatusSegment: View {
	var title: String
	var symbol: String
	var tint: Color
	var ink: Color
	var count = 0
	var selected: Bool
	var identifier: String
	var select: () -> Void

	var body: some View {
		Button {
			withAnimation(.snappy) { select() }
		} label: {
			HStack(spacing: 6) {
				Image(systemName: symbol).fontWeight(.bold)
				if selected {
					Text(title).lineLimit(1)
				} else if count > 0 {
					Text("\(count)").monospacedDigit()
				}
			}
			.font(.subheadline.weight(.semibold))
			.foregroundStyle(selected ? ink : tint)
			.padding(.horizontal, selected ? 16 : 0)
			.frame(minWidth: 60, minHeight: FilterMetrics.height)
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
			.padding(.horizontal, 14)
			.frame(minHeight: FilterMetrics.height)
			.background(active ? Theme.pill : Theme.card2, in: .capsule)
			.contentShape(.capsule)
		}
		.buttonStyle(.plain)
		.accessibilityIdentifier(identifier)
	}
}

private struct SessionRow: View {
	var session: RemoteSessionSummary
	var conversationCwd: String?

	var body: some View {
		let isConversation = session.projectCwd == conversationCwd
		HStack(alignment: .top, spacing: 12) {
			StatusAvatar(status: session.status)
			VStack(alignment: .leading, spacing: 4) {
				HStack(alignment: .firstTextBaseline, spacing: 8) {
					HStack(alignment: .firstTextBaseline, spacing: 4) {
						if session.pinned {
							Image(systemName: "pin.fill")
								.font(.caption.weight(.semibold))
								.foregroundStyle(Theme.yellow)
								.accessibilityLabel(L10n.Session.pinned)
						}
						Text(session.title.trimmingCharacters(in: .whitespaces).isEmpty ? L10n.Home.untitled : session.title)
							.font(.headline)
							.lineLimit(1)
					}
					Spacer(minLength: 0)
					Text(TimeFormat.relative(session.updatedAt))
						.font(.subheadline)
						.foregroundStyle(.secondary)
				}
				if let preview = session.preview?.trimmingCharacters(in: .whitespacesAndNewlines), !preview.isEmpty {
					Text(preview)
						.font(.subheadline)
						.foregroundStyle(.secondary)
						.lineLimit(2)
				}
				HStack(spacing: 3) {
					Image(systemName: isConversation ? "bubble.left" : "folder")
					Text(isConversation ? L10n.Home.conversation : session.projectName).lineLimit(1)
				}
				.font(.caption)
				.foregroundStyle(.secondary)
				.padding(.top, 2)
			}
			// Like Mail, the line starts under the text and leaves the avatar column clear.
			.alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
		}
		.padding(.vertical, 10)
	}
}
