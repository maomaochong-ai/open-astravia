import SwiftUI
import VettaKit

private enum ChatRow: Identifiable {
	case timestamp(Double)
	case item(TranscriptItem)
	case question(RemoteQuestionRequest)

	var id: String {
		switch self {
		case .timestamp: "ts"
		case let .item(item): item.id
		case let .question(request): "q-\(request.requestId)"
		}
	}
}

struct SessionView: View {
	let sessionId: String
	@Environment(AppModel.self) private var model

	private var transcript: TranscriptState { model.transcript(sessionId) }

	private var rows: [ChatRow] {
		var rows: [ChatRow] = []
		if let first = transcript.items.first?.at { rows.append(.timestamp(first)) }
		rows += transcript.items.map(ChatRow.item)
		if let question = transcript.pendingQuestion { rows.append(.question(question)) }
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
					ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
						rowView(row, index: index, rows: rows, active: active)
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
			Composer(
				placeholder: L10n.Chat.composerPlaceholder,
				disabled: !model.online,
				busy: active,
				onStop: { Task { await model.abort(sessionId) } },
				onSend: { text in Task { await model.sendPrompt(sessionId, text) } }
			)
		}
		.navigationBarTitleDisplayMode(.inline)
		// The composer takes the bottom edge; a tab bar under it would stack two glass bars.
		.toolbar(.hidden, for: .tabBar)
		.toolbar {
			ToolbarItem(placement: .principal) {
				TitleWithStatus(title: L10n.Chat.assistant, subtitle: subtitle, online: model.online)
			}
			ToolbarItem(placement: .topBarTrailing) {
				Button { Task { await model.resync(sessionId) } } label: {
					Image(systemName: "arrow.counterclockwise")
				}
				.accessibilityLabel(L10n.Chat.resync)
			}
		}
		.task(id: sessionId) { await model.openSession(sessionId) }
	}

	private var subtitle: String {
		[model.desktop?.desktopName, transcript.sessionState.model].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
	}

	@ViewBuilder
	private func rowView(_ row: ChatRow, index: Int, rows: [ChatRow], active: Bool) -> some View {
		switch row {
		case let .timestamp(at):
			MarkerRow(text: TimeFormat.clock(at))
		case let .question(request):
			QuestionCardView(
				request: request,
				onSubmit: { answers in Task { await model.respond(sessionId, requestId: request.requestId, answers: answers) } },
				onSkip: { Task { await model.respond(sessionId, requestId: request.requestId, answers: [], cancelled: true) } }
			)
			.id(request.requestId)
		case let .item(item):
			switch item {
			case let .user(_, text, _):
				UserBubble(text: text)
			case let .marker(_, text, _):
				MarkerRow(text: text.isEmpty ? L10n.Chat.compacted : text)
			case let .assistant(turn):
				let lastAssistant = index == rows.count - 1 || (index == rows.count - 2 && { if case .question = rows[rows.count - 1] { return true } else { return false } }())
				AssistantTurnView(
					turn: turn,
					showThinking: model.preferences.liveThinking || !turn.streaming,
					statusLine: lastAssistant ? (active ? L10n.Chat.summaryRunning : L10n.Chat.summaryDone) : nil
				)
			}
		}
	}
}
