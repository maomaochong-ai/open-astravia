import SwiftUI
import VettaKit

/// A blank page, pushed from Work, for starting a session in a conversation or a project.
struct NewSessionView: View {
	@Environment(AppModel.self) private var model
	@Environment(Router.self) private var router
	/// `nil` starts in the desktop's conversations.
	@State private var projectCwd: String?
	/// Empty keeps the desktop's default model and thinking level.
	@State private var modelChoice = ModelChoice()
	@State private var pickingModel = false
	@State private var draft = PromptDraft()

	private var projects: [RemoteProjectSummary] { model.projects.filter { !$0.isConversation } }

	var body: some View {
		welcome
			.background { WelcomeBackdrop().ignoresSafeArea() }
			.navigationBarTitleDisplayMode(.inline)
			.toolbarBackground(.hidden, for: .navigationBar)
			.toolbar(.hidden, for: .tabBar)
		.onAppear {
			guard let start = router.failedStart else { return }
			router.failedStart = nil
			draft = start.draft
			projectCwd = start.projectCwd
			modelChoice = start.modelChoice
		}
		.task(id: model.online) {
			guard model.online else { return }
			async let projects: Void = model.refreshProjects()
			await model.loadNewSessionModels()
			await projects
		}
	}

	private var welcome: some View {
		VStack(spacing: 0) {
			Spacer()
			BotAvatar(size: 52, asleep: !model.online)
			Text(L10n.NewSession.greeting)
				.font(.title.weight(.semibold))
				.multilineTextAlignment(.center)
				.padding(.top, 22)
			Text(model.online ? L10n.NewSession.subtitle : L10n.NewSession.offline)
				.font(.subheadline)
				.foregroundStyle(.secondary)
				.multilineTextAlignment(.center)
				.padding(.top, 8)
				.contentTransition(.opacity)
			HStack(spacing: 10) {
				modelMenu
				locationMenu
			}
			.padding(.top, 28)
			Spacer()
		}
		.padding(.horizontal, 24)
		.frame(maxWidth: .infinity)
		.contentShape(Rectangle())
		.onTapGesture { dismissKeyboard() }
		.safeAreaInset(edge: .bottom, spacing: 0) {
			ChatInputBar(draft: $draft, placeholder: L10n.Chat.composerPlaceholder, disabled: !model.online) { sent in
				send(sent)
			}
		}
	}

	private var modelMenu: some View {
		let options = model.newSessionModels
		let name = options.first { $0.key == modelChoice.modelKey }?.name ?? L10n.NewSession.defaultModel
		let text = modelChoice.thinkingLevel.map { "\(name) · \(L10n.Chat.level($0))" } ?? name
		return Button { pickingModel = true } label: {
			MenuChip(symbol: "cpu", text: text)
		}
		.buttonStyle(.glass)
		// A kept list can still be browsed offline; the sheet waits for one that is on its way.
		.disabled(!model.online && options.isEmpty)
		.accessibilityLabel(L10n.Chat.model)
		.accessibilityValue(text)
		.accessibilityIdentifier("newSession.model")
		.sheet(isPresented: $pickingModel) {
			ModelSheet(options: options, choice: modelChoice, offersDefault: true) { modelChoice = $0 }
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
			MenuChip(symbol: project == nil ? "bubble.left" : "folder", text: project?.name ?? L10n.Home.conversation)
		}
		.buttonStyle(.glass)
		.disabled(!model.online)
		.accessibilityLabel(L10n.NewSession.location)
		.accessibilityIdentifier("newSession.location")
	}

	/// Opens the chat at once; the desktop creates the session behind it.
	private func send(_ sent: PromptDraft) {
		let start = NewSessionStart(draft: sent, projectCwd: projectCwd, modelChoice: modelChoice)
		var localId = ""
		guard let id = model.startSession(
			sent.text,
			projectCwd: projectCwd,
			modelKey: modelChoice.modelKey,
			thinkingLevel: modelChoice.thinkingLevel,
			attachments: sent.attachments,
			onFailure: { [router] in router.returnToNewSession(start, from: localId) }
		) else { return }
		localId = id
		router.openSession(id)
	}
}

/// New Session's choices, kept to put back if starting the session fails.
struct NewSessionStart {
	var draft: PromptDraft
	var projectCwd: String?
	var modelChoice: ModelChoice
}

/// A picker's label on New Session: icon, current choice, chevron.
private struct MenuChip: View {
	var symbol: String
	var text: String

	var body: some View {
		HStack(spacing: 5) {
			Image(systemName: symbol)
			Text(text).lineLimit(1)
			Image(systemName: "chevron.up.chevron.down").font(.caption2.weight(.semibold))
		}
		.font(.subheadline.weight(.medium))
		.padding(.horizontal, 2)
	}
}

/// The page fades from the plain background into a deep blue glow at the bottom,
/// like dawn behind the composer. Static: nothing here needs to move.
private struct WelcomeBackdrop: View {
	var body: some View {
		let base = Color(uiColor: .systemBackground)
		MeshGradient(
			width: 3,
			height: 3,
			points: [
				[0, 0], [0.5, 0], [1, 0],
				[0, 0.5], [0.5, 0.55], [1, 0.5],
				[0, 1], [0.5, 1], [1, 1],
			],
			colors: [
				base, base, base,
				base, base, base,
				Theme.dawnSide, Theme.dawn, Theme.dawn,
			]
		)
	}
}
