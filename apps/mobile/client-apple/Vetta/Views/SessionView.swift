import SwiftUI
import VettaKit

private enum ChatRow: Identifiable {
	case timestamp(Double)
	case block(ChatBlock)

	var id: String {
		switch self {
		case .timestamp: "ts"
		case let .block(block): block.id
		}
	}
}

struct SessionView: View {
	let sessionId: String
	@Environment(AppModel.self) private var model
	@State private var draft = PromptDraft()

	/// The desktop's id; a chat opened by New Session starts on a local one.
	private var id: String { model.resolve(sessionId) }
	/// The first prompt of a new session is still on its way to the desktop.
	private var starting: Bool { model.isStarting(sessionId) }
	private var transcript: TranscriptState { model.transcript(id) }

	private var rows: [ChatRow] {
		var rows: [ChatRow] = []
		if let first = transcript.items.first?.at { rows.append(.timestamp(first)) }
		rows += ChatTurns.build(transcript.items, waiting: transcript.sessionState.status.isActive).map(ChatRow.block)
		return rows
	}

	/// Changes whenever new content streams in, to keep the latest line in view.
	private var scrollKey: String {
		let last = transcript.items.last
		var length = 0
		if case let .assistant(turn) = last { length = turn.text.count + turn.thinking.count + turn.tools.count }
		return "\(transcript.items.count)-\(length)-\(transcript.pendingQuestion?.requestId ?? "")"
	}

	var body: some View {
		let rows = rows
		let active = transcript.sessionState.status.isActive
		ScrollViewReader { proxy in
			ScrollView {
				LazyVStack(alignment: .leading, spacing: 0) {
					ForEach(rows) { row in
						rowView(row)
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
				// Tapping the conversation puts the keyboard away; buttons inside keep their own taps.
				.contentShape(Rectangle())
				.onTapGesture { dismissKeyboard() }
			}
			.defaultScrollAnchor(.bottom)
			.scrollDismissesKeyboard(.interactively)
			.onChange(of: scrollKey) {
				withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) }
			}
		}
		.background(Theme.page)
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
					disabled: !model.online || starting,
					busy: active,
					onStop: { if !starting { Task { await model.abort(id) } } },
					onSend: { sent in
						Task {
							// Keep what was typed so a failed send is not lost.
							if await model.sendPrompt(id, sent.text, attachments: sent.attachments) == nil { draft = sent }
						}
					}
				)
			}
		}
		.animation(.snappy, value: transcript.pendingQuestion?.requestId)
		.navigationBarTitleDisplayMode(.inline)
		// The composer takes the bottom edge; a tab bar under it would stack two glass bars.
		.toolbar(.hidden, for: .tabBar)
		.toolbar {
			ToolbarItem(placement: .principal) {
				ModelMenu(sessionId: id, busy: active || starting)
			}
			ToolbarItem(placement: .topBarTrailing) {
				Button { Task { await model.resync(id) } } label: {
					Image(systemName: "arrow.counterclockwise")
				}
				.disabled(starting)
				.accessibilityLabel(L10n.Chat.resync)
			}
		}
		// A new session's history is fetched once its prompt is out; earlier, it would replace the prompt.
		.task(id: "\(id) \(starting)") {
			guard !starting else { return }
			await model.openSession(id)
			await model.loadModels(id)
		}
	}

	@ViewBuilder
	private func rowView(_ row: ChatRow) -> some View {
		switch row {
		case let .timestamp(at):
			MarkerRow(text: TimeFormat.clock(at))
		case let .block(block):
			switch block {
			case let .user(_, text, _, attachments):
				UserBubble(text: text, attachments: attachments)
			case let .marker(_, text, _):
				MarkerRow(text: text.isEmpty ? L10n.Chat.compacted : text)
			case let .turn(turn):
				AgentTurnView(turn: turn, note: turn.streaming ? L10n.Chat.activity(transcript.sessionState.detail) : nil)
			}
		}
	}
}

/// The chat's title: what the session is about, with the model and thinking
/// level underneath. Tapping it opens the model sheet, which switches either
/// one on the desktop.
private struct ModelMenu: View {
	let sessionId: String
	var busy: Bool
	@Environment(AppModel.self) private var model
	@State private var picking = false

	var body: some View {
		let state = model.transcript(sessionId).sessionState
		let options = model.models[sessionId] ?? []
		let current = options.first { $0.key == state.modelKey }
		Button { picking = true } label: {
			VStack(spacing: 1) {
				Text(title).font(.headline).lineLimit(1)
				HStack(spacing: 4) {
					Circle().fill(model.online ? Theme.green : Color.secondary).frame(width: 6, height: 6)
					Text(detail(state: state, current: current)).lineLimit(1)
					if !options.isEmpty {
						Image(systemName: "chevron.down").font(.caption2.weight(.semibold))
					}
				}
				.font(.caption)
				.foregroundStyle(.secondary)
			}
			.frame(maxWidth: 240)
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
