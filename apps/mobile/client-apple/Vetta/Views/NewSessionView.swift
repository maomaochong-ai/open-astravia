import SwiftUI
import VettaKit

/// A blank page, pushed from Work, for starting a session in a conversation or a project.
struct NewSessionView: View {
	@Environment(AppModel.self) private var model
	@Environment(Router.self) private var router
	/// `nil` starts in the desktop's conversations.
	@State private var projectCwd: String?
	@State private var sending = false

	private var projects: [RemoteProjectSummary] { model.projects.filter { !$0.isConversation } }

	var body: some View {
		welcome
			.navigationTitle(L10n.NewSession.title)
			.navigationBarTitleDisplayMode(.large)
			.toolbar(.hidden, for: .tabBar)
		.task(id: model.online) {
			if model.online { await model.refreshProjects() }
		}
	}

	private var welcome: some View {
		VStack(spacing: 12) {
			Spacer()
			Image(systemName: model.online ? "sparkles" : "laptopcomputer.slash")
				.font(.system(size: 44))
				.foregroundStyle(model.online ? Theme.green : .secondary)
				.contentTransition(.symbolEffect(.replace))
			Text(L10n.NewSession.greeting)
				.font(.title2.bold())
				.multilineTextAlignment(.center)
			if !model.online {
				Text(L10n.NewSession.offline)
					.font(.subheadline)
					.foregroundStyle(.secondary)
					.multilineTextAlignment(.center)
			}
			Spacer()
		}
		.padding(.horizontal, 32)
		.frame(maxWidth: .infinity)
		.contentShape(Rectangle())
		.onTapGesture { hideKeyboard() }
		.safeAreaInset(edge: .bottom, spacing: 0) {
			VStack(alignment: .leading, spacing: 0) {
				locationMenu.padding(.horizontal, 16)
				Composer(placeholder: L10n.NewSession.placeholder, leadingIcon: true, disabled: !model.online || sending, busy: sending) { text in
					send(text)
				}
			}
		}
	}

	private var locationMenu: some View {
		Menu {
			Picker(L10n.NewSession.location, selection: $projectCwd) {
				Label(L10n.Home.conversation, systemImage: "bubble.left").tag(String?.none)
				if !projects.isEmpty {
					Section(L10n.Home.kindProject) {
						ForEach(projects, id: \.cwd) { project in
							Label(project.name, systemImage: "folder").tag(Optional(project.cwd))
						}
					}
				}
			}
		} label: {
			let project = projects.first { $0.cwd == projectCwd }
			HStack(spacing: 5) {
				Image(systemName: project == nil ? "bubble.left" : "folder")
				Text(project?.name ?? L10n.Home.conversation).lineLimit(1)
				Image(systemName: "chevron.up.chevron.down").font(.caption2.weight(.semibold))
			}
			.font(.subheadline.weight(.medium))
			.padding(.horizontal, 2)
		}
		.buttonStyle(.glass)
		.disabled(!model.online)
		.accessibilityLabel(L10n.NewSession.location)
		.accessibilityIdentifier("newSession.location")
	}

	private func send(_ text: String) {
		sending = true
		Task {
			defer { sending = false }
			guard let id = await model.sendPrompt(nil, text, projectCwd: projectCwd) else { return }
			router.openSession(id)
		}
	}

	private func hideKeyboard() {
		UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
	}
}
