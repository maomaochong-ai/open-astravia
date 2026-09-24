import SwiftUI
import VettaKit

/// The root page: a greeting, search, the three most recent projects, then every
/// session under a status filter that sticks to the top. Settings and New Session
/// hang off the corners instead of a tab bar.
struct HomeView: View {
	@Environment(AppModel.self) private var model
	@Environment(Router.self) private var router
	@State private var filter = SessionFilter()
	@State private var query = ""
	@FocusState private var searchFocused: Bool
	/// The session whose delete is waiting on confirmation.
	@State private var deleting: RemoteSessionSummary?
	@State private var depth = ScrollDepth()

	/// Searching folds the greeting and the project cards away, from the first tap until cancelled.
	private var searching: Bool { searchFocused || !query.isEmpty }

	private var rows: [RemoteSessionSummary] {
		filter.apply(model.sessions, conversationCwd: model.conversationCwd).filter { HomeSearch.matches($0, query) }
	}

	var body: some View {
		let rows = model.paired ? rows : []
		List {
			Section {
				if !searching { greeting }
				if model.paired {
					searchField
					if searching {
						projectResults
					} else {
						recentProjects
					}
				} else {
					UnpairedView()
						.opacity(model.ready ? 1 : 0)
						.bareRow(top: 40)
				}
			}
			if model.paired {
				Section {
					SessionCardRows(rows: rows, deleting: $deleting)
					if rows.isEmpty { emptyState }
				} header: {
					FilterBar(filter: $filter)
						.padding(.vertical, 10)
						.frame(maxWidth: .infinity)
						.background(Theme.page)
						.listRowInsets(EdgeInsets())
				}
			}
		}
		.listStyle(.plain)
		.scrollContentBackground(.hidden)
		.scrollDismissesKeyboard(.immediately)
		.background { GlowBackdrop(depth: depth) }
		.onScrollGeometryChange(for: CGFloat.self, of: ScrollDepth.read) { _, offset in depth.offset = offset }
		// Pinning moves the row to the top; let it travel there.
		.animation(.snappy, value: rows.map(\.id))
		.animation(.snappy, value: searching)
		.refreshable { await model.refreshSessions() }
		.sessionDeleteDialog($deleting, model: model)
		// The title only names the page for Back and VoiceOver; the greeting stands in for it.
		.navigationTitle(L10n.Home.title)
		.navigationBarTitleDisplayMode(.inline)
		.toolbar {
			ToolbarItem(placement: .topBarLeading) { LinkPill() }
				.sharedBackgroundVisibility(.hidden)
			ToolbarItem(placement: .principal) { Color.clear.frame(width: 1, height: 1) }
			ToolbarItem(placement: .topBarTrailing) {
				Button { router.path.append(.settings) } label: {
					Image(systemName: "gearshape")
				}
				.accessibilityLabel(L10n.Settings.title)
				.accessibilityIdentifier("home.settings")
			}
		}
		.safeAreaBar(edge: .bottom) {
			if model.paired, !searching {
				NewSessionButton { router.startNewSession() }
					.transition(.move(edge: .bottom).combined(with: .opacity))
			}
		}
	}

	private var greeting: some View {
		// The part of the day only needs a look now and then.
		TimelineView(.periodic(from: .now, by: 300)) { context in
			VStack(alignment: .leading, spacing: 2) {
				Text(L10n.Home.greeting(DayPart(context.date)))
					.font(.system(size: 34, weight: .bold))
				Text(L10n.Home.greetingPrompt)
					.font(.system(size: 34, weight: .semibold))
			}
			.foregroundStyle(Theme.ink)
			.frame(maxWidth: .infinity, alignment: .leading)
			.accessibilityElement(children: .combine)
			.accessibilityAddTraits(.isHeader)
		}
		.padding(.horizontal, 20)
		.bareRow(top: 8, bottom: 20)
		.transition(.opacity)
	}

	private var searchField: some View {
		HStack(spacing: 12) {
			HStack(spacing: 10) {
				Image(systemName: "magnifyingglass")
					.font(.title3)
					.foregroundStyle(Theme.dim)
				TextField(L10n.Home.searchPlaceholder, text: $query)
					.font(.body)
					.focused($searchFocused)
					.submitLabel(.search)
					.autocorrectionDisabled()
					.accessibilityIdentifier("home.search")
				if !query.isEmpty {
					Button { query = "" } label: {
						Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.faint)
					}
					.buttonStyle(.plain)
					.accessibilityLabel(L10n.Home.clearFilters)
				}
			}
			.padding(.horizontal, 18)
			.frame(height: 54)
			.background(Theme.card.opacity(0.7), in: .capsule)
			.overlay { Capsule().strokeBorder(Theme.line) }
			.contentShape(.capsule)
			.onTapGesture { searchFocused = true }
			if searching {
				Button(L10n.Common.cancel) {
					query = ""
					searchFocused = false
				}
				.buttonStyle(.plain)
				.foregroundStyle(Theme.ink)
				.transition(.move(edge: .trailing).combined(with: .opacity))
				.accessibilityIdentifier("home.searchCancel")
			}
		}
		// Nothing to search until there is a session.
		.disabled(model.sessions.isEmpty)
		.padding(.horizontal, 16)
		.bareRow(bottom: 8)
	}

	@ViewBuilder
	private var recentProjects: some View {
		let projects = ProjectDigest.recent(model.sessions, conversationCwd: model.conversationCwd)
		if !projects.isEmpty {
			HStack(alignment: .firstTextBaseline) {
				Text(L10n.Home.kindProject)
					.font(.title2.bold())
					.foregroundStyle(Theme.ink)
				Spacer()
				Button { router.path.append(.projects) } label: {
					HStack(spacing: 4) {
						Text(L10n.Home.projectAll)
						Image(systemName: "chevron.right").font(.subheadline.weight(.semibold))
					}
					.font(.body)
					.foregroundStyle(Theme.dim)
				}
				.buttonStyle(.plain)
				.accessibilityIdentifier("home.allProjects")
			}
			.padding(.horizontal, 20)
			.bareRow(top: 20, bottom: 12)
			ProjectCarousel(projects: projects)
				.bareRow(bottom: 12)
		}
	}

	/// Projects whose name matches, above the matching sessions.
	@ViewBuilder
	private var projectResults: some View {
		let projects = ProjectDigest.all(model.sessions, projects: model.projects, conversationCwd: model.conversationCwd)
			.filter { HomeSearch.matches($0, query) }
		if !projects.isEmpty {
			Text(L10n.Home.kindProject)
				.font(.headline)
				.foregroundStyle(Theme.dim)
				.padding(.horizontal, 20)
				.bareRow(top: 12, bottom: 4)
			ForEach(projects) { project in
				Button { router.path.append(.project(project.cwd)) } label: {
					ProjectRow(project: project)
						.frame(maxWidth: .infinity, alignment: .leading)
						.contentShape(.rect)
				}
				.buttonStyle(.plain)
				.padding(.horizontal, 20)
				.bareRow(bottom: 4)
			}
		}
	}

	@ViewBuilder
	private var emptyState: some View {
		Group {
			if model.sessions.isEmpty {
				if model.sessionsLoaded || LinkIndicator(model.link) == .offline {
					// New Session is the floating button right below.
					ContentUnavailableView(L10n.Home.empty, systemImage: "tray", description: Text(L10n.Home.emptyDescription))
				}
			} else if !query.trimmingCharacters(in: .whitespaces).isEmpty {
				ContentUnavailableView.search(text: query)
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
		.bareRow(top: 24)
	}
}
