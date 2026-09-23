import SwiftUI
import VettaKit

struct WorkView: View {
	@Environment(AppModel.self) private var model
	@Environment(Router.self) private var router
	@State private var filter = SessionFilter()
	/// True once the list has scrolled past the large title and the small centred one takes over.
	@State private var titleCollapsed = false

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
			}
		}
		.listStyle(.plain)
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

/// The GitHub-style row of menu chips above the list.
private struct FilterBar: View {
	@Environment(AppModel.self) private var model
	@Binding var filter: SessionFilter

	var body: some View {
		let projects = SessionFilter.projects(in: model.sessions, conversationCwd: model.conversationCwd)
		ScrollView(.horizontal) {
			GlassEffectContainer(spacing: 8) {
				HStack(spacing: 8) {
					FilterChip(
						title: filter.status.map(L10n.Home.group) ?? L10n.Home.statusAll,
						active: filter.status != nil,
						alert: filter.status == nil && model.count(.waiting) > 0,
						identifier: "filter.status"
					) {
						Picker(L10n.Home.filterStatus, selection: $filter.status) {
							Text(L10n.Home.statusAll).tag(SessionStatusGroup?.none)
							ForEach(SessionStatusGroup.allCases, id: \.self) { group in
								Text("\(L10n.Home.group(group))  \(model.count(group))").tag(Optional(group))
							}
						}
					}
					FilterChip(title: kindTitle, active: filter.kind != nil, identifier: "filter.kind") {
						Picker(L10n.Home.filterKind, selection: $filter.kind.animation()) {
							Text(L10n.Home.kindAll).tag(SessionKind?.none)
							Text(L10n.Home.kindConversation).tag(Optional(SessionKind.conversation))
							Text(L10n.Home.kindProject).tag(Optional(SessionKind.project))
						}
					}
					if filter.kind == .project {
						FilterChip(
							title: projects.first { $0.cwd == filter.projectCwd }?.name ?? L10n.Home.projectAll,
							active: filter.projectCwd != nil,
							identifier: "filter.project"
						) {
							Picker(L10n.Home.filterProject, selection: $filter.projectCwd) {
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
		}
		.scrollIndicators(.hidden)
		.scrollClipDisabled()
	}

	private var kindTitle: String {
		switch filter.kind {
		case nil: L10n.Home.kindAll
		case .conversation: L10n.Home.kindConversation
		case .project: L10n.Home.kindProject
		}
	}
}

private struct FilterChip<Content: View>: View {
	var title: String
	var active: Bool
	var alert = false
	var identifier: String
	@ViewBuilder var content: () -> Content

	var body: some View {
		let menu = Menu {
			content()
		} label: {
			HStack(spacing: 5) {
				if alert {
					Circle().fill(Theme.orange).frame(width: 7, height: 7)
				}
				Text(title)
				Image(systemName: "chevron.down").font(.caption2.weight(.semibold))
			}
			.font(.subheadline.weight(.medium))
			.padding(.horizontal, 2)
		}
		.accessibilityIdentifier(identifier)
		if active {
			menu.buttonStyle(.glassProminent).tint(Theme.pill).foregroundStyle(Theme.pillInk)
		} else {
			menu.buttonStyle(.glass)
		}
	}
}

private struct SessionRow: View {
	var session: RemoteSessionSummary
	var conversationCwd: String?

	var body: some View {
		let isConversation = session.projectCwd == conversationCwd
		VStack(alignment: .leading, spacing: 4) {
			HStack(alignment: .firstTextBaseline, spacing: 8) {
				Text(session.title.trimmingCharacters(in: .whitespaces).isEmpty ? L10n.Home.untitled : session.title)
					.font(.headline)
					.lineLimit(1)
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
			HStack(spacing: 8) {
				// Finished sessions stay quiet so the ones that need a look stand out.
				if session.status != .idle, session.status != .completed {
					StatusBadge(status: session.status)
				}
				HStack(spacing: 3) {
					Image(systemName: isConversation ? "bubble.left" : "folder")
					Text(isConversation ? L10n.Home.conversation : session.projectName).lineLimit(1)
				}
				.font(.caption)
				.foregroundStyle(.secondary)
			}
			.padding(.top, 2)
		}
		.padding(.vertical, 4)
		.alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
	}
}
