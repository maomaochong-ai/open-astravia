import SwiftUI
import VettaKit

struct UserBubble: View {
	var text: String

	var body: some View {
		HStack {
			Spacer(minLength: 48)
			Text(text)
				.font(.system(size: 15))
				.lineSpacing(4)
				.foregroundStyle(Theme.pillInk)
				.textSelection(.enabled)
				.padding(.horizontal, 16)
				.padding(.vertical, 12)
				.background(
					UnevenRoundedRectangle(topLeadingRadius: 20, bottomLeadingRadius: 20, bottomTrailingRadius: 6, topTrailingRadius: 20, style: .continuous)
						.fill(Theme.pill)
				)
		}
		.padding(.bottom, 16)
	}
}

struct MarkerRow: View {
	var text: String

	var body: some View {
		Text(text)
			.font(.system(size: 11))
			.foregroundStyle(Theme.faint)
			.frame(maxWidth: .infinity)
			.padding(.bottom, 16)
	}
}

func toolSymbol(_ toolName: String) -> String {
	let name = toolName.lowercased()
	if name.contains("search") || name.contains("fetch") || name.contains("web") { return "magnifyingglass" }
	if name.contains("bash") || name.contains("shell") || name.contains("exec") || name.contains("terminal") { return "apple.terminal" }
	if name.contains("aggregate") || name.contains("data") || name.contains("compute") { return "gearshape.2" }
	return "wrench.and.screwdriver"
}

/// First scalar argument, as the Expo card showed it next to the tool name.
func summarizeArgs(_ args: String?) -> String {
	guard let args, !args.isEmpty else { return "" }
	if let value = try? JSONValue.parse(args), let fields = value.objectValue {
		let ordered = orderedKeys(args).compactMap { fields[$0] }
		for field in ordered {
			if let text = field.stringValue { return String(text.prefix(60)) }
			if let number = field.numberValue { return String(JSONValue.number(number).serialized().prefix(60)) }
		}
	}
	return String(args.prefix(60))
}

/// Top-level keys in source order (JSON objects lose order once parsed).
private func orderedKeys(_ json: String) -> [String] {
	guard let data = json.data(using: .utf8),
	      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
	else { return [] }
	return object.keys.sorted { lhs, rhs in
		(json.range(of: "\"\(lhs)\"")?.lowerBound ?? json.endIndex) < (json.range(of: "\"\(rhs)\"")?.lowerBound ?? json.endIndex)
	}
}

struct ToolCardView: View {
	var tool: ToolCard
	@State private var open = false

	private var badge: (label: String, tone: PillTone) {
		switch tool.status {
		case .done: (tool.label ?? L10n.Chat.toolDone, .green)
		case .failed: (L10n.Chat.toolFailed, .orange)
		case .generating: (L10n.Chat.toolGenerating, .neutral)
		case .running: (tool.label ?? L10n.Chat.toolRunning, .neutral)
		}
	}

	var body: some View {
		let summary = summarizeArgs(tool.args)
		let detail = tool.result ?? tool.args
		VStack(alignment: .leading, spacing: 0) {
			Button {
				withAnimation(.snappy) { open.toggle() }
			} label: {
				HStack(spacing: 10) {
					Image(systemName: toolSymbol(tool.toolName))
						.font(.system(size: 14, weight: .medium))
						.foregroundStyle(Theme.green)
						.frame(width: 18)
					Text("\(Text(tool.toolName).foregroundStyle(Theme.ink))\(Text(summary.isEmpty ? "" : ": \(summary)").foregroundStyle(Theme.ink2))")
						.font(.mono(13))
						.lineLimit(1)
						.frame(maxWidth: .infinity, alignment: .leading)
					if tool.status == .running || tool.status == .generating {
						ProgressView().controlSize(.mini)
					}
					Pill(text: badge.label, tone: badge.tone)
					Image(systemName: open ? "chevron.up" : "chevron.down")
						.font(.system(size: 11, weight: .semibold))
						.foregroundStyle(Theme.dim)
				}
				.padding(.horizontal, 14)
				.padding(.vertical, 12)
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			if open, let detail, !detail.isEmpty {
				Rectangle().fill(Theme.line).frame(height: 1)
				VStack(alignment: .leading, spacing: 8) {
					Text(detail)
						.font(.mono(12))
						.lineSpacing(4)
						.foregroundStyle(Theme.ink2)
						.lineLimit(30)
						.textSelection(.enabled)
					if let duration = tool.durationMs {
						Text("\(Int(duration.rounded())) ms").font(.mono(11)).foregroundStyle(Theme.faint)
					}
				}
				.padding(.horizontal, 14)
				.padding(.vertical, 12)
				.frame(maxWidth: .infinity, alignment: .leading)
			}
		}
		.glassEffect(.regular, in: .rect(cornerRadius: 16))
		.padding(.bottom, 8)
	}
}

struct ThinkingBlock: View {
	var text: String
	var live: Bool
	@State private var open = false

	var body: some View {
		if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
			VStack(alignment: .leading, spacing: 4) {
				Button {
					withAnimation(.snappy) { open.toggle() }
				} label: {
					HStack(spacing: 6) {
						Image(systemName: "brain").font(.system(size: 12)).foregroundStyle(Theme.dim)
						Text(live ? L10n.Chat.thinkingLive : L10n.Chat.thinking)
							.font(.system(size: 12))
							.foregroundStyle(Theme.dim)
						Image(systemName: open ? "chevron.up" : "chevron.down")
							.font(.system(size: 10, weight: .semibold))
							.foregroundStyle(Theme.faint)
					}
					.padding(.vertical, 4)
				}
				.buttonStyle(.plain)
				if open || live {
					Text(text)
						.font(.system(size: 13))
						.lineSpacing(4)
						.foregroundStyle(Theme.faint)
						.lineLimit(open ? nil : 4)
				}
			}
			.padding(.bottom, 8)
		}
	}
}

struct AssistantTurnView: View {
	var turn: AssistantTurn
	var showThinking: Bool
	var statusLine: String?

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			HStack(spacing: 8) {
				Text("V")
					.font(.system(size: 11, weight: .bold))
					.foregroundStyle(Theme.avatarInk)
					.frame(width: 24, height: 24)
					.background(Circle().fill(Theme.green))
				Text("Vetta").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink)
				if let statusLine {
					Text(statusLine).font(.system(size: 12)).foregroundStyle(Theme.dim)
				}
				if turn.streaming {
					ProgressView().controlSize(.mini)
				}
			}
			.padding(.bottom, 10)
			if showThinking {
				ThinkingBlock(text: turn.thinking, live: turn.streaming && turn.text.isEmpty)
			}
			ForEach(turn.tools) { tool in
				ToolCardView(tool: tool)
			}
			if !turn.text.isEmpty {
				MarkdownView(text: turn.text).padding(.top, 4)
			}
			if let error = turn.error {
				Text(L10n.Chat.errorPrefix + error)
					.font(.system(size: 13))
					.foregroundStyle(Theme.red)
					.padding(.top, 4)
			}
		}
		.padding(.bottom, 20)
		.frame(maxWidth: .infinity, alignment: .leading)
	}
}

struct QuestionCardView: View {
	var request: RemoteQuestionRequest
	var onSubmit: ([RemoteQuestionAnswer]) -> Void
	var onSkip: () -> Void
	@State private var selected: [Int: [String]] = [:]

	private var complete: Bool {
		request.questions.indices.allSatisfy { !(selected[$0] ?? []).isEmpty }
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			Text(L10n.Chat.questionTitle)
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(Theme.orange)
			ForEach(Array(request.questions.enumerated()), id: \.offset) { index, question in
				VStack(alignment: .leading, spacing: 0) {
					Text(question.question).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
					if !question.header.isEmpty {
						Text(question.header).font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 2)
					}
					VStack(spacing: 8) {
						ForEach(question.options, id: \.label) { option in
							optionButton(index: index, option: option, multi: question.multiSelect)
						}
					}
					.padding(.top, 10)
				}
				.padding(.top, 12)
			}
			HStack(spacing: 8) {
				Spacer()
				Button(L10n.Chat.questionSkip, action: onSkip)
					.buttonStyle(.glass)
					.tint(Theme.dim)
					.accessibilityIdentifier("question.skip")
				Button {
					onSubmit(request.questions.enumerated().map { index, question in
						RemoteQuestionAnswer(question: question.question, answers: selected[index] ?? [])
					})
				} label: {
					Text(L10n.Chat.questionSubmit)
						.font(.system(size: 13, weight: .semibold))
						.foregroundStyle(complete ? Theme.pillInk : Theme.faint)
				}
				.buttonStyle(.glassProminent)
				.tint(complete ? Theme.pill : Theme.card2)
				.disabled(!complete)
				.accessibilityIdentifier("question.submit")
			}
			.padding(.top, 16)
		}
		.padding(16)
		.glassEffect(.regular.tint(Theme.orange.opacity(0.06)), in: .rect(cornerRadius: 20))
		.overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Theme.orange.opacity(0.35), lineWidth: 1))
		.padding(.bottom, 20)
	}

	private func optionButton(index: Int, option: RemoteQuestionOption, multi: Bool) -> some View {
		let active = (selected[index] ?? []).contains(option.label)
		return Button {
			withAnimation(.snappy) {
				var current = selected[index] ?? []
				if !multi {
					current = [option.label]
				} else if let position = current.firstIndex(of: option.label) {
					current.remove(at: position)
				} else {
					current.append(option.label)
				}
				selected[index] = current
			}
		} label: {
			HStack {
				VStack(alignment: .leading, spacing: 2) {
					Text(option.label).font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink)
					if !option.description.isEmpty {
						Text(option.description).font(.system(size: 12)).foregroundStyle(Theme.dim)
					}
				}
				Spacer()
				if active {
					Image(systemName: "checkmark").font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.green)
				}
			}
			.padding(.horizontal, 14)
			.padding(.vertical, 12)
			.background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(active ? Theme.greenSoft : Theme.card2))
			.overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(active ? Theme.green : Theme.line, lineWidth: 1))
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.accessibilityAddTraits(active ? .isSelected : [])
		.accessibilityIdentifier("question.option.\(option.label)")
	}
}
