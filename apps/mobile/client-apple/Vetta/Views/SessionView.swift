import SwiftUI
import VettaKit

struct SessionView: View {
	let sessionId: String
	@Environment(AppModel.self) private var model
	@Environment(Router.self) private var router
	@State private var draft = PromptDraft()
	@State private var pageWidth: CGFloat = 0
	@State private var renaming = false
	@State private var newTitle = ""
	/// A send puts its message at the top of the chat; the reply then fills in
	/// below it without moving the conversation, which the user scrolls by hand.
	@State private var pinned = false
	/// A send is waiting for its message to show up, to scroll it to the top.
	@State private var pinPending = false
	/// The latest message when the send went out; the exchange is held to a screen's
	/// height only once a newer one arrives, never an old exchange of any length.
	@State private var pinnedAfter: String?
	/// The chat's height, which the latest exchange fills once sent.
	@State private var viewport: CGFloat = 0
	/// Far enough from the end to offer a jump there.
	@State private var farFromEnd = false
	/// The panel the More menu opened.
	@State private var panel: SessionPanel?
	/// A desktop file a reply linked to, being previewed.
	@State private var linkedFile: LinkedFile?

	/// The desktop's id; a chat opened by New Session starts on a local one.
	private var id: String { model.resolve(sessionId) }
	/// The first prompt of a new session is still on its way to the desktop.
	private var starting: Bool { model.isStarting(sessionId) }
	private var transcript: TranscriptState { model.transcript(id) }
	/// New Session from here starts in this chat's project; `nil` is the conversations.
	private var newSessionCwd: String? {
		guard let cwd = model.session(id)?.projectCwd, cwd != model.conversationCwd else { return nil }
		return cwd
	}

	var body: some View {
		let active = transcript.sessionState.status.isActive
		let (rows, latest) = ChatLines.build(transcript.items, waiting: active)
		let latestUser = latest < rows.endIndex ? rows[latest].id : nil
		// Only an exchange sent from here is laid out as one piece; any other stays lazy row by row.
		let split = pinned && latestUser != pinnedAfter ? latest : rows.endIndex
		ScrollViewReader { proxy in
			ScrollView {
				LazyVStack(alignment: .leading, spacing: 0) {
					ForEach(rows[..<split]) { row in
						rowView(row)
					}
					// An exchange sent from here takes at least a screen, so its
					// message can sit at the top while the reply is still short.
					if split < rows.endIndex {
						VStack(alignment: .leading, spacing: 0) {
							ForEach(rows[split...]) { row in
								rowView(row)
							}
						}
						.frame(minHeight: pinned ? max(0, viewport - 16) : nil, alignment: .top)
						// Scrolled to as one piece: a row nested in here is not a lazy item of its own.
						.id(Self.latestExchange)
					}
					if rows.isEmpty {
						Text(transcript.loaded ? (model.session(id)?.title ?? "") : L10n.Chat.loadingHistory)
							.font(.system(size: 13))
							.foregroundStyle(Theme.dim)
							.frame(maxWidth: .infinity)
							.padding(.vertical, 64)
					}
					Color.clear.frame(height: 1).id("bottom")
				}
				.padding(.horizontal, 20)
				.padding(.top, 8)
				.padding(.bottom, 16)
				// A live turn's new pieces and, once it ends, its copy button ease in instead of popping.
				.animation(.easeOut(duration: 0.3), value: Self.liveShape(rows))
				// Tapping the conversation puts the keyboard away; buttons inside keep their own taps.
				.contentShape(Rectangle())
				.onTapGesture { dismissKeyboard() }
			}
			// A reply's link to a desktop file opens it here; web links still go to Safari.
			.environment(\.openURL, OpenURLAction { url in
				guard case let .desktopFile(href) = ReplyLink.classify(url) else { return .systemAction }
				linkedFile = LinkedFile(href: href)
				return .handled
			})
			// Opens on the newest line, but streaming never moves the conversation: following
			// a reply that grows every frame kept the scroll view animating and stuttered.
			.defaultScrollAnchor(.bottom, for: .initialOffset)
			.scrollDismissesKeyboard(.interactively)
			// A geometry change, not a scroll one: that fires only on a change, which left a
			// chat nothing had moved yet with no height to put the sent message at the top.
			.onGeometryChange(for: CGFloat.self, of: ChatViewport.height) { viewport = $0 }
			// A flag, not the distance, so scrolling only reaches the view when it flips.
			.onScrollGeometryChange(for: Bool.self, of: ChatViewport.farFromEnd) { _, far in
				withAnimation(.snappy) { farFromEnd = far }
			}
			// Floats just above the composer, which the safe area already keeps clear.
			.overlay(alignment: .bottom) {
				if farFromEnd {
					Button {
						withAnimation(.smooth(duration: 0.35)) { proxy.scrollTo("bottom", anchor: .bottom) }
					} label: {
						Image(systemName: "arrow.down")
							.font(.system(size: 17, weight: .semibold))
							.frame(width: 44, height: 44)
							.glassEffect(.regular.interactive(), in: .circle)
					}
					.buttonStyle(.plain)
					.accessibilityLabel(L10n.Chat.scrollToBottom)
					.accessibilityIdentifier("chat.scrollToBottom")
					.padding(.bottom, 12)
					.transition(.scale(scale: 0.6).combined(with: .opacity))
				}
			}
			// History that arrives after the chat opened lands past the initial offset.
			.onChange(of: transcript.loaded) { _, loaded in
				if loaded, !pinned { proxy.scrollTo("bottom", anchor: .bottom) }
			}
			.onChange(of: latestUser) { _, user in
				guard pinPending, user != nil else { return }
				pinPending = false
				// Once the keyboard is down and the exchange has its screen of height laid out:
				// scrolling any sooner stops at the old bottom, short of the top.
				Task { @MainActor in
					try? await Task.sleep(for: .milliseconds(300))
					withAnimation(.smooth(duration: 0.35)) { proxy.scrollTo(Self.latestExchange, anchor: .top) }
				}
			}
		}
		.background(Theme.page)
		.onGeometryChange(for: CGFloat.self, of: \.size.width) { pageWidth = $0 }
		// A bar, not a plain inset: the conversation fades out under the composer like it
		// does under the title, instead of running into it.
		.safeAreaBar(edge: .bottom) {
			// While the agent waits on an answer, the question takes the composer's place.
			if let request = transcript.pendingQuestion {
				QuestionPanel(
					request: request,
					onSubmit: { answers in Task { await model.respond(id, requestId: request.requestId, answers: answers) } },
					onCancel: { Task { await model.respond(id, requestId: request.requestId, answers: [], cancelled: true) } }
				)
				.id(request.requestId)
			} else {
				ChatInputBar(
					draft: $draft,
					placeholder: L10n.Chat.composerPlaceholder,
					skillScope: model.session(model.resolve(id))?.projectCwd,
					sendDisabled: !model.online || starting,
					busy: active,
					onStop: { if !starting { Task { await model.abort(id) } } },
					onSend: { sent in
						// The sent message takes the whole screen's top, not the strip above the keyboard.
						dismissKeyboard()
						// Room below goes in before the message does, so the scroll has somewhere to go.
						pinnedAfter = latestUser
						pinned = true
						pinPending = true
						Task {
							// Keep what was typed so a failed send is not lost.
							if await model.sendPrompt(id, sent.promptText, attachments: sent.attachments) == nil {
								draft = sent
								pinPending = false
							}
						}
					}
				)
			}
		}
		.animation(.snappy, value: transcript.pendingQuestion?.requestId)
		.navigationBarTitleDisplayMode(.inline)
		// The composer takes the bottom edge; a tab bar under it would stack two glass bars.
		.toolbar {
			ToolbarItem(placement: .topBarLeading) { DrawerButton() }
			// Beside the drawer button rather than centred, so a long title gets the width the buttons leave.
			ToolbarItem(placement: .topBarLeading) {
				ModelMenu(sessionId: id, busy: active || starting, pageWidth: pageWidth)
			}
			.sharedBackgroundVisibility(.hidden)
			ToolbarItemGroup(placement: .topBarTrailing) {
				Button { router.startNewSession(in: newSessionCwd) } label: {
					Image(systemName: "square.and.pencil")
				}
				.accessibilityLabel(L10n.NewSession.title)
				.accessibilityIdentifier("chat.newSession")
				Menu {
					// The desktop's activity panel tabs, one entry each as the phone gains them.
					Section(L10n.Files.panels) {
						ForEach(SessionPanel.allCases) { item in
							let available = model.isAvailable(item)
							Button { panel = item } label: {
								Label(item.title, systemImage: item.systemImage)
								// Said only once the desktop's status is in, so a slow link does not claim it is old.
								if !available, model.link.desktop != nil { Text(L10n.Files.needsDesktopUpdate) }
							}
							.disabled(!available || !model.online)
						}
					}
					Button(L10n.Chat.resync, systemImage: "arrow.clockwise") { Task { await model.resync(id) } }
					// The desktop's own sidebar actions, so it shows the same title and pin.
					Button(L10n.Session.rename, systemImage: "pencil") {
						newTitle = model.session(id)?.title ?? ""
						renaming = true
					}
					.disabled(!model.online)
					let pinned = model.session(id)?.pinned == true
					Button(pinned ? L10n.Session.unpin : L10n.Session.pin, systemImage: pinned ? "pin.slash" : "pin") {
						Task { await model.setPinned(id, !pinned) }
					}
					.disabled(!model.online)
				} label: {
					Image(systemName: "square.grid.2x2")
				}
				.accessibilityLabel(L10n.Chat.more)
				.accessibilityIdentifier("chat.more")
				// A chat New Session is still starting has no desktop session to act on yet.
				.disabled(starting)
			}
		}
		.sheet(item: $panel) { panel in
			SessionPanelSheet(panel: panel, sessionId: id)
		}
		.sheet(item: $linkedFile) { file in
			NavigationStack {
				FilePreviewScreen(sessionId: id, path: file.href, title: file.title)
			}
			.presentationDetents([.large])
			.presentationDragIndicator(.visible)
		}
		.alert(L10n.Session.renameTitle, isPresented: $renaming) {
			TextField(L10n.Session.renameTitle, text: $newTitle)
			Button(L10n.Common.cancel, role: .cancel) {}
			Button(L10n.Common.save) { Task { await model.rename(id, to: newTitle) } }
				.disabled(newTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
		}
		// A new session is opened once its prompt is out; `openSession` then skips the history, which may still lack it.
		.task(id: "\(id) \(starting)") {
			guard !starting else { return }
			await model.openSession(id)
			await model.loadModels(id)
		}
		// A resync (the desktop restarted) empties every transcript; refetch the one on screen.
		.onChange(of: transcript.stale) { _, stale in
			if stale, !starting { Task { await model.openSession(id) } }
		}
	}

	private static let latestExchange = "latest-exchange"

	@ViewBuilder
	private func rowView(_ row: ChatLine) -> some View {
		switch row {
		case let .timestamp(at):
			MarkerRow(text: TimeFormat.clock(at))
		case let .user(_, text, attachments):
			UserBubble(text: text, attachments: attachments)
		case let .marker(_, text):
			MarkerRow(text: text.isEmpty ? L10n.Chat.compacted : text)
		case let .head(id, startedAt, streaming, empty, ends):
			TurnHeader(id: id, startedAt: startedAt, streaming: streaming, empty: empty, note: streaming ? L10n.Chat.activity(transcript.sessionState.detail) : nil)
				.padding(.bottom, ends ? 20 : 10)
				.frame(maxWidth: .infinity, alignment: .leading)
		case let .piece(segment, live, ends, activity):
			TurnPieceView(segment: segment, live: live, activity: activity)
				.padding(.bottom, ends ? 20 : 10)
				.frame(maxWidth: .infinity, alignment: .leading)
		case let .foot(_, conclusion):
			TurnCopyButton(conclusion: conclusion)
				.padding(.bottom, 20)
				.frame(maxWidth: .infinity, alignment: .leading)
				.transition(.opacity.combined(with: .offset(y: 4)))
		}
	}

	/// The rows of a turn still running, or nil once it is done: what the chat animates on.
	private static func liveShape(_ rows: [ChatLine]) -> [String]? {
		guard let head = rows.lastIndex(where: { if case .head = $0 { true } else { false } }),
		      case .head(_, _, true, _, _) = rows[head]
		else { return nil }
		return rows[head...].map(\.id)
	}
}

/// Runs on SwiftUI's render thread on device, so it must stay nonisolated.
private enum ChatViewport {
	/// The whole frame, bars included: room to spare below a sent message costs a little
	/// blank space, while room short of the visible height leaves it below the top.
	/// Whole points, so the keyboard's slide does not re-lay the chat on every fraction.
	nonisolated static func height(_ proxy: GeometryProxy) -> CGFloat {
		proxy.size.height.rounded()
	}

	nonisolated static func farFromEnd(_ geometry: ScrollGeometry) -> Bool {
		ChatScroll.offersJump(below: geometry.contentSize.height - geometry.visibleRect.maxY, viewport: geometry.containerSize.height)
	}
}

/// A reply's link to a desktop file, kept as written for the desktop to resolve.
private struct LinkedFile: Identifiable {
	let href: String
	var id: String { href }
	var title: String { (href.removingPercentEncoding ?? href).split(separator: "/").last.map(String.init) ?? href }
}

/// The chat's title: what the session is about, with the model and thinking
/// level underneath. Tapping it opens the model sheet, which switches either
/// one on the desktop.
private struct ModelMenu: View {
	let sessionId: String
	var busy: Bool
	var pageWidth: CGFloat
	@Environment(AppModel.self) private var model
	@State private var picking = false

	var body: some View {
		let state = model.transcript(sessionId).sessionState
		let options = model.models[sessionId] ?? []
		let current = options.first { $0.key == state.modelKey }
		Button { picking = true } label: {
			ModelTitle(title: title, detail: detail(state: state, current: current), online: model.online, picks: !options.isEmpty)
			// A toolbar item only gets its ideal width; claim what the drawer button and the two on the right leave.
			.frame(width: max(120, pageWidth - 212), alignment: .leading)
		}
		.buttonStyle(.plain)
		// Switching mid-turn would change the model under a running reply.
		.disabled(options.isEmpty || busy || !model.online)
		.accessibilityIdentifier("chat.modelMenu")
		.sheet(isPresented: $picking) {
			ModelSheet(options: options, choice: ModelChoice(modelKey: state.modelKey, thinkingLevel: state.thinkingLevel)) { next in
				apply(next, over: state)
			}
		}
	}

	/// Sends what changed. A new model is sent with the level the sheet kept for it,
	/// so the desktop does not fall back to that model's default under the sheet.
	private func apply(_ next: ModelChoice, over state: RemoteSessionState) {
		let modelChanged = next.modelKey != state.modelKey
		let modelKey = modelChanged ? next.modelKey : nil
		let level = modelChanged || next.thinkingLevel != state.thinkingLevel ? next.thinkingLevel : nil
		Task { await model.configure(sessionId, modelKey: modelKey, thinkingLevel: level) }
	}

	private var title: String {
		guard let session = model.session(sessionId) else {
			// A session New Session is still starting is titled by its prompt.
			if case let .user(_, text, _, _)? = model.transcript(sessionId).items.first { return text }
			return L10n.Home.untitled
		}
		let title = session.title.trimmingCharacters(in: .whitespaces)
		return title.isEmpty ? L10n.Home.untitled : title
	}

	private func detail(state: RemoteSessionState, current: RemoteModelOption?) -> String {
		let name = current?.name ?? state.model ?? model.desktop?.desktopName ?? ""
		guard let level = state.thinkingLevel, let current, !current.thinkingLevels.isEmpty else { return name }
		return "\(name) · \(L10n.Chat.level(level))"
	}
}
