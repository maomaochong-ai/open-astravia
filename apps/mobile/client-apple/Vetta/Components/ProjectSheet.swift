import SwiftUI
import VettaKit

/// The one place a project is chosen, rising from the bottom: the desktop's conversations and
/// every project, most recently active first, with a search once there are many. New Session
/// picks where to start; Home's filter adds a first row for every session.
struct ProjectSheet: View {
	var selection: ProjectScope
	/// Adds "All Sessions" above the conversations (Home's filter).
	var offersAll = false
	var onPick: (ProjectScope) -> Void
	@Environment(AppModel.self) private var model
	@Environment(\.dismiss) private var dismiss
	@State private var query = ""

	private var searching: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }

	var body: some View {
		let projects = ProjectDigest.all(model.sessions, projects: model.projects, conversationCwd: model.conversationCwd)
			.filter { !searching || HomeSearch.matches($0, query) }
		NavigationStack {
			List {
				if !searching {
					Section {
						if offersAll {
							row(.all, symbol: "tray.full", title: L10n.Home.allSessions, detail: L10n.Home.sessionCount(model.sessions.count))
						}
						row(.conversations, symbol: "bubble.left", title: L10n.Home.conversation, detail: L10n.Home.sessionCount(conversationCount))
					}
				}
				if !projects.isEmpty {
					Section(L10n.Home.kindProject) {
						ForEach(projects) { project in
							row(.project(project.cwd), symbol: projectSymbol, title: project.name, detail: ProjectRow.detail(project))
						}
					}
				}
			}
			.overlay {
				if searching, projects.isEmpty { ContentUnavailableView.search(text: query) }
			}
			.searchable(text: $query)
			.navigationTitle(L10n.Home.pickProject)
			.navigationBarTitleDisplayMode(.inline)
			.toolbar {
				ToolbarItem(placement: .cancellationAction) {
					Button(L10n.Common.close, systemImage: "xmark") { dismiss() }
				}
			}
		}
		.presentationDetents([.medium, .large])
		.presentationDragIndicator(.visible)
		// Brings in projects the phone has no session for yet.
		.task(id: model.online) {
			if model.online { await model.refreshProjects() }
		}
	}

	private static func identifier(_ scope: ProjectScope) -> String {
		switch scope {
		case .all: "projectSheet.all"
		case .conversations: "projectSheet.conversations"
		case let .project(cwd): "projectSheet.\(cwd)"
		}
	}

	private var conversationCount: Int {
		model.sessions.count { $0.projectCwd == model.conversationCwd }
	}

	private func row(_ scope: ProjectScope, symbol: String, title: String, detail: String) -> some View {
		let chosen = scope == selection
		return Button {
			onPick(scope)
			dismiss()
		} label: {
			HStack(spacing: 12) {
				Image(systemName: symbol)
					.font(.body.weight(.medium))
					.foregroundStyle(Theme.ink2)
					.frame(width: 36, height: 36)
					.background(Theme.card2, in: .rect(cornerRadius: 10, style: .continuous))
				VStack(alignment: .leading, spacing: 2) {
					Text(title).foregroundStyle(Theme.ink).lineLimit(1)
					Text(detail).font(.caption).foregroundStyle(Theme.dim).lineLimit(1)
				}
				Spacer(minLength: 0)
				if chosen {
					Image(systemName: "checkmark").font(.body.weight(.semibold))
				}
			}
			.contentShape(.rect)
		}
		.buttonStyle(.plain)
		.accessibilityAddTraits(chosen ? .isSelected : [])
		.accessibilityIdentifier(Self.identifier(scope))
	}
}
