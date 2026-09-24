import SwiftUI
import VettaKit

/// The root slot with no session in it: a blank page for starting one in a conversation or a project.
/// Until a desktop is paired it only shows how to pair.
struct NewSessionView: View {
	@Environment(AppModel.self) private var model
	@Environment(Router.self) private var router
	/// `nil` starts in the desktop's conversations.
	@State private var projectCwd: String?
	/// Empty keeps the desktop's default model and thinking level.
	@State private var modelChoice = ModelChoice()
	@State private var pickingModel = false
	@State private var pickingProject = false
	@State private var draft = PromptDraft()
	@State private var pageWidth: CGFloat = 0
	@State private var keyboardUp = false

	init(projectCwd: String? = nil) {
		_projectCwd = State(initialValue: projectCwd)
	}

	private var offline: Bool { LinkIndicator(model.link) == .offline }

	var body: some View {
		Group {
			if model.paired {
				welcome
			} else {
				UnpairedView()
					.opacity(model.ready ? 1 : 0)
			}
		}
		.background { WelcomeBackdrop().ignoresSafeArea() }
		.onGeometryChange(for: CGFloat.self, of: \.size.width) { pageWidth = $0 }
		.navigationBarTitleDisplayMode(.inline)
		.toolbarBackground(.hidden, for: .navigationBar)
		.toolbar {
			if model.paired {
				ToolbarItem(placement: .topBarLeading) { DrawerButton() }
				// Where the chat keeps its model, so both pages switch it in the same place.
				ToolbarItem(placement: .topBarLeading) { modelMenu }
					.sharedBackgroundVisibility(.hidden)
			}
		}
		.onAppear {
			guard let start = router.failedStart else {
				modelChoice = model.lastModelChoice.available(in: model.newSessionModels)
				return
			}
			router.failedStart = nil
			draft = start.draft
			projectCwd = start.projectCwd
			modelChoice = start.modelChoice
		}
		// A remembered model the desktop has since dropped falls back to its default.
		.onChange(of: model.newSessionModels) { _, options in
			modelChoice = modelChoice.available(in: options)
		}
		.task(id: model.online) {
			guard model.online else { return }
			async let projects: Void = model.refreshProjects()
			await model.loadNewSessionModels()
			await projects
		}
	}

	private var welcome: some View {
		let cards = TaskBoard.cards(model.sessions, conversationCwd: model.conversationCwd)
		return VStack(alignment: .leading, spacing: 0) {
			// With nothing on the board the avatar has no header to sit in; it greets from the top.
			if cards.isEmpty {
				// Asleep only once the link has failed, not while the first connect is under way.
				BotAvatar(size: 40, asleep: offline, blinksOnAppear: 3)
					.padding(.bottom, 18)
			}
			greeting
			locationMenu
				.padding(.top, 18)
			Spacer(minLength: 16)
			// Typing is about the new session; the board steps aside for the keyboard.
			if !keyboardUp {
				BoardSummary(cards: cards, avatarAsleep: offline)
					// Clear of the composer, which has no top margin of its own.
					.padding(.bottom, 14)
					.transition(.opacity)
			}
		}
		.padding(.horizontal, 24)
		.padding(.top, 12)
		.padding(.bottom, 12)
		.frame(maxWidth: .infinity, alignment: .leading)
		.contentShape(Rectangle())
		.onTapGesture { dismissKeyboard() }
		.animation(.snappy, value: keyboardUp)
		.onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardUp = true }
		.onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardUp = false }
		// Until the desktop answers, the link pill stands where the composer goes: it spins
		// while connecting and, once the link has failed, offers a reconnect.
		.safeAreaInset(edge: .bottom, spacing: 0) {
			Group {
				if model.online {
					ChatInputBar(draft: $draft, placeholder: L10n.Chat.composerPlaceholder) { sent in
						send(sent)
					}
				} else {
					LinkPill()
						.frame(maxWidth: .infinity)
						.padding(.bottom, 8)
				}
			}
			.animation(.snappy, value: model.online)
		}
	}

	/// Two large lines at the top left, the second lit in the backdrop's colours.
	private var greeting: some View {
		VStack(alignment: .leading, spacing: 2) {
			Text(L10n.NewSession.greeting)
				.foregroundStyle(Theme.ink)
			Text(L10n.NewSession.subtitle)
				.foregroundStyle(LinearGradient(colors: [Theme.greetingStart, Theme.greetingEnd], startPoint: .leading, endPoint: .trailing))
		}
		.font(.system(size: 34, weight: .semibold))
		.multilineTextAlignment(.leading)
		.accessibilityElement(children: .combine)
		.accessibilityAddTraits(.isHeader)
	}

	private var modelMenu: some View {
		let options = model.newSessionModels
		let name = options.first { $0.key == modelChoice.modelKey }?.name ?? L10n.NewSession.defaultModel
		let text = modelChoice.thinkingLevel.map { "\(name) · \(L10n.Chat.level($0))" } ?? name
		return Button { pickingModel = true } label: {
			ModelTitle(title: L10n.NewSession.title, detail: text, online: model.online, picks: !options.isEmpty)
				// A toolbar item only gets its ideal width; claim what the drawer button leaves.
				.frame(width: max(120, pageWidth - 110), alignment: .leading)
		}
		.buttonStyle(.plain)
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
		let name = projectCwd.map(projectName) ?? L10n.Home.conversation
		return Button { pickingProject = true } label: {
			MenuChip(symbol: projectCwd == nil ? "bubble.left" : "folder", text: name)
		}
		.buttonStyle(.glass)
		.accessibilityLabel(L10n.NewSession.location)
		.accessibilityValue(name)
		.accessibilityIdentifier("newSession.location")
		.sheet(isPresented: $pickingProject) {
			ProjectSheet(selection: projectCwd.map(ProjectScope.project) ?? .conversations) { scope in
				if case let .project(cwd) = scope { projectCwd = cwd } else { projectCwd = nil }
			}
		}
	}

	private func projectName(_ cwd: String) -> String {
		model.projects.first { $0.cwd == cwd }?.name
			?? model.sessions.first { $0.projectCwd == cwd }?.projectName
			?? URL(fileURLWithPath: cwd).lastPathComponent
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
		router.show(id)
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

/// A violet-to-blue wash over the top of the page that fades into the background by
/// the middle, so the board and the composer sit on the plain page. Toned down in light
/// mode. It fades in once as the page opens and then holds still.
private struct WelcomeBackdrop: View {
	@Environment(\.colorScheme) private var colorScheme
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@State private var lit = false

	var body: some View {
		ZStack {
			Color(uiColor: .systemBackground)
			LinearGradient(colors: [Theme.welcomeViolet, Theme.welcomeBlue], startPoint: .topLeading, endPoint: .trailing)
				.mask {
					LinearGradient(
						stops: [
							.init(color: .black, location: 0),
							.init(color: .black.opacity(0.7), location: 0.22),
							.init(color: .clear, location: 0.5),
						],
						startPoint: .top,
						endPoint: .bottom
					)
				}
				.opacity(lit ? (colorScheme == .dark ? 1 : 0.35) : 0)
				.animation(.easeOut(duration: 0.8), value: lit)
		}
		.onAppear {
			var transaction = Transaction()
			transaction.disablesAnimations = reduceMotion
			withTransaction(transaction) { lit = true }
		}
	}
}
