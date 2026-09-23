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

	private var transcript: TranscriptState { model.transcript(sessionId) }

	private var rows: [ChatRow] {
		var rows: [ChatRow] = []
		if let first = transcript.items.first?.at { rows.append(.timestamp(first)) }
		rows += ChatTurns.build(transcript.items).map(ChatRow.block)
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
						Text(transcript.loaded ? (model.session(sessionId)?.title ?? "") : L10n.Chat.loadingHistory)
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
			}
			.defaultScrollAnchor(.bottom)
			.scrollDismissesKeyboard(.interactively)
			.onChange(of: scrollKey) {
				withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) }
			}
		}
		.background(Theme.page)
		.safeAreaInset(edge: .bottom) {
			// While the agent waits on an answer, the question takes the composer's place.
			if let request = transcript.pendingQuestion {
				QuestionPanel(
					request: request,
					onSubmit: { answers in Task { await model.respond(sessionId, requestId: request.requestId, answers: answers) } },
					onCancel: { Task { await model.respond(sessionId, requestId: request.requestId, answers: [], cancelled: true) } }
				)
				.id(request.requestId)
			} else {
				ChatInputBar(
					draft: $draft,
					placeholder: L10n.Chat.composerPlaceholder,
					disabled: !model.online,
					busy: active,
					onStop: { Task { await model.abort(sessionId) } },
					onSend: { sent in
						Task {
							// Keep what was typed so a failed send is not lost.
							if await model.sendPrompt(sessionId, sent.text, attachments: sent.attachments) == nil { draft = sent }
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
				ModelMenu(sessionId: sessionId, busy: active)
			}
			ToolbarItem(placement: .topBarTrailing) {
				Button { Task { await model.resync(sessionId) } } label: {
					Image(systemName: "arrow.counterclockwise")
				}
				.accessibilityLabel(L10n.Chat.resync)
			}
		}
		.task(id: sessionId) {
			await model.openSession(sessionId)
			await model.loadModels(sessionId)
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
				AgentTurnView(turn: turn)
			}
		}
	}
}

/// The chat's title: what the session is about, with the model and thinking
/// level underneath. Tapping it switches either one on the desktop.
private struct ModelMenu: View {
	let sessionId: String
	var busy: Bool
	@Environment(AppModel.self) private var model

	var body: some View {
		let state = model.transcript(sessionId).sessionState
		let options = model.models[sessionId] ?? []
		let current = options.first { $0.key == state.modelKey }
		Menu {
			if !options.isEmpty {
				Picker(L10n.Chat.model, selection: Binding(
					get: { state.modelKey ?? "" },
					set: { key in Task { await model.configure(sessionId, modelKey: key) } }
				)) {
					ForEach(options) { option in
						Text(option.name).tag(option.key)
					}
				}
				.pickerStyle(.inline)
			}
			if let levels = current?.thinkingLevels, !levels.isEmpty {
				Picker(L10n.Chat.thinkingLevel, selection: Binding(
					get: { state.thinkingLevel ?? "" },
					set: { level in Task { await model.configure(sessionId, thinkingLevel: level) } }
				)) {
					ForEach(levels, id: \.self) { level in
						Text(L10n.Chat.level(level)).tag(level)
					}
				}
				.pickerStyle(.inline)
			}
		} label: {
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
	}

	private var title: String {
		let title = model.session(sessionId)?.title.trimmingCharacters(in: .whitespaces) ?? ""
		return title.isEmpty ? L10n.Home.untitled : title
	}

	private func detail(state: RemoteSessionState, current: RemoteModelOption?) -> String {
		let name = current?.name ?? state.model ?? model.desktop?.desktopName ?? ""
		guard let level = state.thinkingLevel, let current, !current.thinkingLevels.isEmpty else { return name }
		return "\(name) · \(L10n.Chat.level(level))"
	}
}
