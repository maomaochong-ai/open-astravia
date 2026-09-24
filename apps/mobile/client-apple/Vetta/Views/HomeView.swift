import SwiftUI
import VettaKit

/// The drawer over the slot: the Vetta title and Close stay at the top, then a short list of
/// ways in (New Session, the task board) and every session under a status filter that sticks
/// to the top. The link pill, Search and Settings float at the bottom, and Search opens its
/// field there. Only there once a desktop is paired.
struct HomeView: View {
	@Environment(AppModel.self) private var model
	@Environment(Router.self) private var router
	@State private var filter = SessionFilter()
	@State private var query = ""
	@State private var searchActive = false
	/// The session whose delete is waiting on confirmation.
	@State private var deleting: RemoteSessionSummary?
	@State private var depth = ScrollDepth()

	/// Searching folds the top bar and the ways in away and lists matching projects, from the first tap until cancelled.
	private var searching: Bool { searchActive || !query.isEmpty }

	private var rows: [RemoteSessionSummary] {
		filter.apply(model.sessions, conversationCwd: model.conversationCwd).filter { HomeSearch.matches($0, query) }
	}

	var body: some View {
		let rows = rows
		List {
			Section {
				if searching {
					projectResults
				} else {
					entries
				}
			}
			Section {
				SessionCardRows(rows: rows, deleting: $deleting)
				if rows.isEmpty { emptyState }
			} header: {
				FilterBar(filter: $filter).pinnedFilterHeader(depth)
			}
		}
		.listStyle(.plain)
		.scrollContentBackground(.hidden)
		.scrollDismissesKeyboard(.immediately)
		.background { GlowBackdrop(depth: depth) }
		.trackScrollDepth(depth)
		// Pinning moves the row to the top; let it travel there.
		.animation(.snappy, value: rows.map(\.id))
		.animation(.snappy, value: searching)
		.refreshable { await model.refreshSessions() }
		.sessionDeleteDialog($deleting, model: model)
		// The title only names the page for Back and VoiceOver.
		.navigationTitle(L10n.Home.title)
		.toolbarVisibility(.hidden, for: .navigationBar)
		.safeAreaBar(edge: .top) {
			if !searching {
				topBar.transition(.move(edge: .top).combined(with: .opacity))
			}
		}
		.safeAreaBar(edge: .bottom) { bottomBar }
	}

	private var topBar: some View {
		HStack {
			Text(L10n.appName)
				.font(.title.bold())
				.foregroundStyle(Theme.ink)
				.accessibilityAddTraits(.isHeader)
			Spacer()
			GlassCircleButton(symbol: "xmark", size: 48, label: L10n.Common.close, identifier: "home.close") {
				router.closeDrawer()
			}
		}
		.padding(.horizontal, 16)
		.padding(.top, 4)
		.padding(.bottom, 8)
	}

	@ViewBuilder
	private var bottomBar: some View {
		if searching {
			NativeSearchBar(text: $query, active: $searchActive.animation(.snappy), placeholder: L10n.Home.searchPlaceholder, focused: true)
				.padding(.horizontal, 8)
				.padding(.bottom, 4)
				.transition(.opacity)
		} else {
			HStack(spacing: 12) {
				LinkPill()
				Spacer()
				Group {
					GlassCircleButton(symbol: "magnifyingglass", size: 56, label: L10n.Home.search, identifier: "home.search") {
						withAnimation(.snappy) { searchActive = true }
					}
					// Nothing to search until there is a session.
					.disabled(model.sessions.isEmpty)
					GlassCircleButton(symbol: "gearshape", size: 56, label: L10n.Settings.title, identifier: "home.settings") {
						router.path.append(.settings)
					}
				}
			}
			.padding(.bottom, 4)
			.padding(.horizontal, 16)
			.transition(.opacity)
		}
	}

	/// Ways in, as plain icon-and-label rows.
	@ViewBuilder
	private var entries: some View {
		EntryRow(symbol: "square.and.pencil", title: L10n.NewSession.title, identifier: "home.newSession") {
			router.startNewSession()
		}
		// Only the way in for now; the board itself comes later.
		EntryRow(symbol: "rectangle.3.group", title: L10n.Home.taskBoard, identifier: "home.taskBoard") {}
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
					// New Session is the floating button at the bottom.
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

/// One of Home's ways in: an icon and a label, no background.
private struct EntryRow: View {
	var symbol: String
	var title: String
	var identifier: String
	var action: () -> Void

	var body: some View {
		Button(action: action) {
			HStack(spacing: 14) {
				Image(systemName: symbol)
					.font(.title3)
					.frame(width: 28)
				Text(title)
					.font(.body.weight(.medium))
				Spacer(minLength: 0)
			}
			.foregroundStyle(Theme.ink)
			.padding(.horizontal, 20)
			.padding(.vertical, 12)
			.contentShape(.rect)
		}
		.buttonStyle(.plain)
		.accessibilityIdentifier(identifier)
		.bareRow()
	}
}
