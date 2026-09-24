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
		VStack(spacing: 0) {
			Spacer()
			// Asleep only once the link has failed, not while the first connect is under way.
			BotAvatar(size: 52, asleep: offline, blinksOnAppear: 3)
			Text(L10n.NewSession.greeting)
				.font(.title.weight(.semibold))
				.multilineTextAlignment(.center)
				.padding(.top, 22)
			subtitle
				.font(.subheadline)
				.foregroundStyle(.secondary)
				.multilineTextAlignment(.center)
				.padding(.top, 8)
				.animation(.snappy, value: LinkIndicator(model.link))
			locationMenu
				.padding(.top, 28)
			Spacer()
		}
		.padding(.horizontal, 24)
		.frame(maxWidth: .infinity)
		.contentShape(Rectangle())
		.onTapGesture { dismissKeyboard() }
		.safeAreaInset(edge: .bottom, spacing: 0) {
			ChatInputBar(draft: $draft, placeholder: L10n.Chat.composerPlaceholder, sendDisabled: !model.online) { sent in
				send(sent)
			}
		}
	}

	/// Says the phone is still reaching the desktop, so a send button that waits does not look stuck.
	@ViewBuilder
	private var subtitle: some View {
		switch LinkIndicator(model.link) {
		case .online:
			Text(L10n.NewSession.subtitle)
		case .connecting:
			connecting(L10n.NewSession.connecting)
		case let .reconnecting(attempt):
			connecting(L10n.Link.reconnecting(attempt))
		case .offline:
			Text(L10n.NewSession.offline)
		}
	}

	private func connecting(_ text: String) -> some View {
		HStack(spacing: 6) {
			ProgressView().controlSize(.mini)
			Text(text)
		}
		.accessibilityElement(children: .combine)
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

/// As the page opens, a soft light rises from behind the composer and spreads
/// sideways like light off a matte wall, then holds still: white in dark mode,
/// pale blue in light. Plain gradients only, so nothing is blurred per frame.
private struct WelcomeBackdrop: View {
	@Environment(\.colorScheme) private var colorScheme
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	@State private var lit = false

	var body: some View {
		// Full-strength white would glare in the dark; pale blue is already soft.
		let strength = colorScheme == .dark ? 0.26 : 0.9
		GeometryReader { proxy in
			let w = proxy.size.width
			let h = proxy.size.height
			ZStack {
				Color(uiColor: .systemBackground)
				// A faint wash that reaches furthest up the page.
				lobe(strength * 0.45, width: w * 1.8, height: h * 0.9)
					.position(x: w / 2, y: h)
					.opacity(lit ? 1 : 0)
					.animation(.easeOut(duration: 2.2).delay(0.4), value: lit)
				// The core, rising from under the composer.
				lobe(strength, width: w * 1.3, height: h * 0.5)
					.scaleEffect(x: lit ? 1 : 0.45, y: lit ? 1 : 0.3, anchor: .bottom)
					.position(x: w / 2, y: h)
					.opacity(lit ? 1 : 0)
					.animation(.easeOut(duration: 1.4), value: lit)
				// Two side lobes drift out of the core, so the light diffuses rather than just fades in.
				ForEach([-1.0, 1.0], id: \.self) { side in
					lobe(strength * 0.7, width: w * 0.95, height: h * 0.36)
						.position(x: w / 2 + side * w * (lit ? 0.36 : 0.08), y: h * 0.98)
						.opacity(lit ? 1 : 0)
						.animation(.easeOut(duration: 1.8).delay(side < 0 ? 0.25 : 0.35), value: lit)
				}
			}
		}
		.onAppear {
			var transaction = Transaction()
			transaction.disablesAnimations = reduceMotion
			withTransaction(transaction) { lit = true }
		}
	}

	private func lobe(_ opacity: Double, width: CGFloat, height: CGFloat) -> some View {
		EllipticalGradient(
			colors: [Theme.welcomeGlow.opacity(opacity), Theme.welcomeGlow.opacity(opacity * 0.4), Theme.welcomeGlow.opacity(0)],
			center: .center,
			startRadiusFraction: 0,
			endRadiusFraction: 0.5
		)
		.frame(width: width, height: height)
	}
}
