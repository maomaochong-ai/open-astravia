import SwiftUI
import VettaKit

/// One project's sessions, filtered by status; New Session starts in this project.
struct ProjectView: View {
	let cwd: String
	@Environment(AppModel.self) private var model
	@Environment(Router.self) private var router
	@State private var filter: SessionFilter
	@State private var deleting: RemoteSessionSummary?
	@State private var depth = ScrollDepth()

	init(cwd: String) {
		self.cwd = cwd
		_filter = State(initialValue: SessionFilter(kind: .project, projectCwd: cwd))
	}

	private var name: String {
		model.sessions.first { $0.projectCwd == cwd }?.projectName
			?? model.projects.first { $0.cwd == cwd }?.name
			?? URL(fileURLWithPath: cwd).lastPathComponent
	}

	var body: some View {
		let rows = filter.apply(model.sessions, conversationCwd: model.conversationCwd)
		List {
			Section {
				SessionCardRows(rows: rows, showsProject: false, deleting: $deleting)
				if rows.isEmpty, model.sessionsLoaded {
					Group {
						if filter.status == nil {
							ContentUnavailableView(L10n.Home.empty, systemImage: "tray", description: Text(L10n.Home.emptyDescription))
						} else {
							ContentUnavailableView {
								Label(L10n.Home.emptyFiltered, systemImage: "line.3.horizontal.decrease.circle")
							} description: {
								Text(L10n.Home.emptyFilteredDescription)
							} actions: {
								Button(L10n.Home.clearFilters) { withAnimation { filter.status = nil } }
							}
						}
					}
					.bareRow(top: 24)
				}
			} header: {
				FilterBar(filter: $filter, showsProject: false).pinnedFilterHeader(depth)
			}
		}
		.listStyle(.plain)
		.scrollContentBackground(.hidden)
		.background { GlowBackdrop(depth: depth) }
		.trackScrollDepth(depth)
		.animation(.snappy, value: rows.map(\.id))
		.refreshable { await model.refreshSessions() }
		.sessionDeleteDialog($deleting, model: model)
		.navigationTitle(name)
		.navigationBarTitleDisplayMode(.large)
		.safeAreaBar(edge: .bottom) {
			NewSessionButton { router.startNewSession(in: cwd) }
		}
	}
}
