import SwiftUI
import VettaKit

/// Takes the composer's place while the agent waits on an AskUserQuestion,
/// like the desktop's question panel: tabs for several questions, single or
/// multiple choice, a free-text "Other", then Next / Submit or Cancel.
struct QuestionPanel: View {
	var onSubmit: ([RemoteQuestionAnswer]) -> Void
	var onCancel: () -> Void
	@State private var draft: QuestionDraft
	@State private var submitted = false
	@FocusState private var otherFocused: Bool

	init(request: RemoteQuestionRequest, onSubmit: @escaping ([RemoteQuestionAnswer]) -> Void, onCancel: @escaping () -> Void) {
		self.onSubmit = onSubmit
		self.onCancel = onCancel
		_draft = State(initialValue: QuestionDraft(request: request))
	}

	var body: some View {
		let index = draft.current
		let question = draft.request.questions[index]
		VStack(alignment: .leading, spacing: 12) {
			HStack(spacing: 8) {
				Image(systemName: "questionmark.circle.fill").foregroundStyle(Theme.orange)
				Text(L10n.Chat.questionTitle).font(.subheadline.weight(.semibold))
				Spacer(minLength: 0)
				if draft.count > 1 {
					Text("\(draft.answeredCount)/\(draft.count)")
						.font(.caption.monospacedDigit())
						.foregroundStyle(.secondary)
				}
			}
			if draft.count > 1 { tabs }
			ScrollView {
				VStack(alignment: .leading, spacing: 10) {
					if draft.count == 1, !question.header.isEmpty {
						Text(question.header)
							.font(.caption.weight(.medium))
							.padding(.horizontal, 8)
							.padding(.vertical, 3)
							.background(Theme.card2, in: .capsule)
					}
					Text(question.question).font(.headline)
					if question.multiSelect {
						Text(L10n.Chat.questionMultiHint).font(.caption).foregroundStyle(.secondary)
					}
					ForEach(question.options, id: \.label) { option in
						optionRow(option, index: index, multi: question.multiSelect)
					}
					otherRow(index: index)
				}
				.id(index)
				.transition(.opacity)
			}
			.scrollBounceBehavior(.basedOnSize)
			.frame(maxHeight: 360)
			.fixedSize(horizontal: false, vertical: true)
			HStack(spacing: 10) {
				Spacer()
				Button(L10n.Common.cancel, action: onCancel)
					.buttonStyle(.glass)
					.disabled(submitted)
					.accessibilityIdentifier("question.cancel")
				if draft.count > 1, !draft.isLast {
					Button(L10n.Chat.questionNext) { withAnimation(.snappy) { draft.next() } }
						.buttonStyle(.glassProminent)
						.tint(Theme.pill)
						.foregroundStyle(Theme.pillInk)
						.disabled(!draft.isAnswered(index))
						.accessibilityIdentifier("question.next")
				} else {
					Button(L10n.Chat.questionSubmit) {
						submitted = true
						onSubmit(draft.result)
					}
					.buttonStyle(.glassProminent)
					.tint(Theme.pill)
					.foregroundStyle(Theme.pillInk)
					.disabled(!draft.allAnswered || submitted)
					.accessibilityIdentifier("question.submit")
				}
			}
		}
		.padding(16)
		.glassEffect(.regular, in: .rect(cornerRadius: 24))
		.overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(Theme.orange.opacity(0.35), lineWidth: 1))
		.padding(.horizontal, 12)
		.padding(.bottom, 8)
		.transition(.move(edge: .bottom).combined(with: .opacity))
	}

	private var tabs: some View {
		ScrollView(.horizontal) {
			HStack(spacing: 6) {
				ForEach(draft.request.questions.indices, id: \.self) { index in
					let header = draft.request.questions[index].header
					Button {
						withAnimation(.snappy) { draft.current = index }
					} label: {
						HStack(spacing: 4) {
							if draft.isAnswered(index) { Image(systemName: "checkmark") }
							Text(header.isEmpty ? L10n.Chat.questionTab(index + 1) : header).lineLimit(1)
						}
						.font(.caption.weight(.medium))
						.padding(.horizontal, 10)
						.padding(.vertical, 6)
						.foregroundStyle(index == draft.current ? Theme.pillInk : .primary)
						.background(index == draft.current ? Theme.pill : Theme.card2, in: .capsule)
					}
					.buttonStyle(.plain)
					.accessibilityIdentifier("question.tab.\(index)")
				}
			}
		}
		.scrollIndicators(.hidden)
	}

	private func optionRow(_ option: RemoteQuestionOption, index: Int, multi: Bool) -> some View {
		let active = draft.isSelected(option.label, at: index)
		return Button {
			withAnimation(.snappy) { draft.toggle(option.label, at: index) }
		} label: {
			HStack(alignment: .top, spacing: 10) {
				Image(systemName: marker(active: active, multi: multi))
					.foregroundStyle(active ? Theme.ink : .secondary)
				VStack(alignment: .leading, spacing: 2) {
					Text(option.label).font(.subheadline.weight(.semibold))
					if !option.description.isEmpty {
						Text(option.description).font(.caption).foregroundStyle(.secondary)
					}
				}
				Spacer(minLength: 0)
			}
			.padding(12)
			.background(active ? Theme.ink.opacity(0.08) : Theme.card2.opacity(0.6), in: .rect(cornerRadius: 14))
			.overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(active ? Theme.ink : .clear, lineWidth: 1))
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.accessibilityAddTraits(active ? .isSelected : [])
		.accessibilityIdentifier("question.option.\(option.label)")
	}

	private func otherRow(index: Int) -> some View {
		let active = draft.isOtherActive(at: index)
		let multi = draft.request.questions[index].multiSelect
		return VStack(alignment: .leading, spacing: 8) {
			Button {
				withAnimation(.snappy) { draft.toggleOther(at: index) }
				otherFocused = draft.isOtherActive(at: index)
			} label: {
				HStack(spacing: 10) {
					Image(systemName: active ? marker(active: true, multi: multi) : "pencil")
						.foregroundStyle(active ? Theme.ink : .secondary)
					Text(L10n.Chat.questionOther).font(.subheadline)
					Spacer(minLength: 0)
				}
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.accessibilityIdentifier("question.other")
			if active {
				TextField(L10n.Chat.questionOtherPlaceholder, text: Binding(
					get: { draft.otherText(at: index) },
					set: { draft.setOtherText($0, at: index) }
				), axis: .vertical)
				.lineLimit(1 ... 4)
				.focused($otherFocused)
				.accessibilityIdentifier("question.otherField")
			}
		}
		.padding(12)
		.overlay(
			RoundedRectangle(cornerRadius: 14, style: .continuous)
				.stroke(active ? Theme.ink : Color.secondary.opacity(0.4), style: StrokeStyle(lineWidth: 1, dash: active ? [] : [4, 3]))
		)
	}

	private func marker(active: Bool, multi: Bool) -> String {
		multi ? (active ? "checkmark.square.fill" : "square") : (active ? "largecircle.fill.circle" : "circle")
	}
}
