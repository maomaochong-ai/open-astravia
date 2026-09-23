import SwiftUI
import VettaKit

/// Model and thinking level, picked from a sheet that rises from the bottom.
/// New Session and the chat title both open it: New Session keeps the choice
/// until it sends, the chat applies each pick on the desktop right away.
struct ModelSheet: View {
	var options: [RemoteModelOption]
	/// Adds a first row for the desktop's default model (New Session).
	var offersDefault = false
	var onChange: (ModelChoice) -> Void
	/// Follows each tap at once; the owner's choice may only catch up after a round trip.
	@State private var choice: ModelChoice
	@Environment(\.dismiss) private var dismiss

	init(options: [RemoteModelOption], choice: ModelChoice, offersDefault: Bool = false, onChange: @escaping (ModelChoice) -> Void) {
		self.options = options
		self.offersDefault = offersDefault
		self.onChange = onChange
		_choice = State(initialValue: choice)
	}

	var body: some View {
		NavigationStack {
			List {
				let levels = choice.levels(in: options)
				if !levels.isEmpty {
					Section(L10n.Chat.thinkingLevel) {
						LevelPicker(levels: levels, selected: choice.thinkingLevel ?? current?.defaultThinkingLevel) { level in
							update { $0.thinkingLevel = level }
						}
						.listRowInsets(EdgeInsets())
					}
				}
				if offersDefault {
					Section {
						row(L10n.NewSession.defaultModel, hint: L10n.NewSession.defaultModelHint, key: nil)
					}
				}
				if options.isEmpty {
					HStack(spacing: 10) {
						ProgressView()
						Text(L10n.Chat.modelsLoading).foregroundStyle(.secondary)
					}
				}
				ForEach(ModelChoice.groups(options), id: \.provider) { group in
					Section(group.provider) {
						ForEach(group.models) { option in
							row(option.name, key: option.key)
						}
					}
				}
			}
			.animation(.snappy, value: choice.modelKey)
			.navigationTitle(L10n.Chat.model)
			.navigationBarTitleDisplayMode(.inline)
			.toolbar {
				ToolbarItem(placement: .confirmationAction) {
					Button(L10n.Common.done) { dismiss() }
						.accessibilityIdentifier("modelSheet.done")
				}
			}
		}
		.presentationDetents([.medium, .large])
		.presentationDragIndicator(.visible)
	}

	private var current: RemoteModelOption? { options.first { $0.key == choice.modelKey } }

	private func row(_ name: String, hint: String? = nil, key: String?) -> some View {
		Button {
			update { $0.pick(key, in: options) }
		} label: {
			HStack(spacing: 12) {
				VStack(alignment: .leading, spacing: 2) {
					Text(name).foregroundStyle(.primary)
					if let hint {
						Text(hint).font(.caption).foregroundStyle(.secondary)
					}
				}
				Spacer(minLength: 0)
				if choice.modelKey == key {
					Image(systemName: "checkmark").font(.body.weight(.semibold))
				}
			}
			.contentShape(Rectangle())
		}
		.accessibilityAddTraits(choice.modelKey == key ? .isSelected : [])
		.accessibilityIdentifier("modelSheet.model.\(key ?? "default")")
	}

	private func update(_ change: (inout ModelChoice) -> Void) {
		var next = choice
		change(&next)
		guard next != choice else { return }
		choice = next
		onChange(next)
	}
}

/// The chosen model's thinking levels as a row of capsules.
private struct LevelPicker: View {
	var levels: [String]
	var selected: String?
	var onSelect: (String) -> Void

	var body: some View {
		ScrollView(.horizontal) {
			HStack(spacing: 8) {
				ForEach(levels, id: \.self) { level in
					let on = level == selected
					Button { onSelect(level) } label: {
						Text(L10n.Chat.level(level))
							.font(.subheadline.weight(.medium))
							.foregroundStyle(on ? Theme.pillInk : Theme.ink)
							.padding(.horizontal, 14)
							.frame(height: 34)
							.background(on ? Theme.pill : Theme.card2, in: .capsule)
					}
					.buttonStyle(.plain)
					.accessibilityAddTraits(on ? .isSelected : [])
					.accessibilityIdentifier("modelSheet.level.\(level)")
				}
			}
			.padding(.horizontal, 16)
			.padding(.vertical, 10)
		}
		.scrollIndicators(.hidden)
		.animation(.snappy, value: selected)
	}
}
