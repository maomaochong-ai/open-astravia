import SwiftUI
import VettaKit

/// The Skills row's sheet: the desktop's skills and scenes for the project the
/// prompt goes to, in the order its composer lists them. The last list shows
/// at once while a fresh one loads. Tapping one adds it to the prompt and closes.
struct SkillSheet: View {
	/// The project the prompt goes to; nil for a conversation.
	var cwd: String?
	var selected: [SkillReference]
	var onPick: (SkillReference) -> Void

	@Environment(AppModel.self) private var model
	@Environment(\.dismiss) private var dismiss
	@State private var query = ""

	private var catalog: SkillCatalog { model.skillCatalog(cwd: cwd) }
	private var hasScene: Bool { selected.contains { $0.kind == .scene } }

	var body: some View {
		NavigationStack {
			content
				.navigationTitle(L10n.Skills.title)
				.navigationBarTitleDisplayMode(.inline)
		}
		.searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: L10n.Skills.search)
		.presentationDetents([.medium, .large])
		.presentationDragIndicator(.visible)
		.task { await model.loadSkills(cwd: cwd) }
	}

	@ViewBuilder
	private var content: some View {
		if let options = catalog.options {
			let shown = options.matching(query)
			if options.isEmpty, catalog.failed {
				failure
			} else if options.isEmpty {
				ContentUnavailableView(L10n.Skills.empty, systemImage: "sparkles")
			} else if shown.isEmpty {
				ContentUnavailableView(L10n.Skills.noMatch, systemImage: "magnifyingglass")
			} else {
				list(shown)
			}
		} else if catalog.failed {
			failure
		} else {
			ProgressView()
				.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
	}

	private var failure: some View {
		ContentUnavailableView {
			Label(L10n.Skills.loadFailed, systemImage: "exclamationmark.triangle")
		} actions: {
			Button(L10n.Skills.retry) { Task { await model.loadSkills(cwd: cwd) } }
				.buttonStyle(.glass)
				.accessibilityIdentifier("skills.retry")
		}
	}

	private func list(_ options: [RemoteSkillOption]) -> some View {
		List {
			Section {
				ForEach(options) { option in
					row(option)
				}
			} footer: {
				if hasScene, options.contains(where: { $0.kind == .scene }) {
					Text(L10n.Skills.sceneReplaces)
				}
			}
			// A refresh that failed keeps the list it had; offer to try again below it.
			if catalog.failed {
				Section {
					Button(L10n.Skills.retry) { Task { await model.loadSkills(cwd: cwd) } }
				} header: {
					Text(L10n.Skills.loadFailed)
				}
			}
		}
		.listStyle(.plain)
		.scrollContentBackground(.hidden)
		.accessibilityIdentifier("skills.list")
	}

	private func row(_ option: RemoteSkillOption) -> some View {
		let added = selected.contains(option.reference)
		return Button {
			onPick(option.reference)
			dismiss()
		} label: {
			HStack(alignment: .top, spacing: 14) {
				Image(systemName: SkillChip.symbol(option.kind))
					.font(.system(size: 18))
					.frame(width: 26, height: 22)
					.foregroundStyle(.secondary)
				VStack(alignment: .leading, spacing: 3) {
					HStack(spacing: 6) {
						Text(option.displayName)
							.font(.body)
							.lineLimit(1)
						if option.kind == .scene { tag(L10n.Skills.scene) }
						if let source = L10n.Skills.source(option.source) { tag(source) }
					}
					if !option.description.isEmpty {
						Text(option.description)
							.font(.subheadline)
							.foregroundStyle(.secondary)
							.lineLimit(2)
					}
				}
				Spacer(minLength: 0)
				if added {
					Image(systemName: "checkmark")
						.font(.system(size: 15, weight: .semibold))
						.foregroundStyle(.secondary)
						.accessibilityLabel(L10n.Skills.added)
				}
			}
			.foregroundStyle(.primary)
			.contentShape(.rect)
		}
		.buttonStyle(.plain)
		.disabled(added)
		.opacity(added ? 0.5 : 1)
		.accessibilityElement(children: .combine)
		.accessibilityIdentifier("skills.row")
	}

	private func tag(_ text: String) -> some View {
		Text(text)
			.font(.caption2.weight(.medium))
			.foregroundStyle(.secondary)
			.padding(.horizontal, 6)
			.padding(.vertical, 2)
			.background(Theme.card2, in: .capsule)
			.fixedSize()
	}
}

/// A referenced skill above the composer or in a sent message.
struct SkillChip: View {
	var skill: SkillReference
	var onRemove: (() -> Void)?

	@Environment(AppModel.self) private var model

	static func symbol(_ kind: RemoteSkillOption.Kind) -> String {
		kind == .scene ? "theatermasks" : "sparkles"
	}

	var body: some View {
		let name = model.skillName(skill)
		HStack(spacing: 6) {
			Image(systemName: Self.symbol(skill.kind))
				.font(.system(size: 12, weight: .medium))
			Text(name)
				.font(.subheadline.weight(.medium))
				.lineLimit(1)
			if let onRemove {
				Button(action: onRemove) {
					Image(systemName: "xmark")
						.font(.system(size: 10, weight: .bold))
						.frame(width: 18, height: 18)
						.contentShape(.circle)
				}
				.buttonStyle(.plain)
				.foregroundStyle(.secondary)
				.accessibilityLabel(L10n.Chat.removeAttachment(name))
			}
		}
		.padding(.leading, 10)
		.padding(.trailing, onRemove == nil ? 10 : 6)
		.frame(height: 30)
		.background(Theme.card2, in: .capsule)
		.accessibilityElement(children: .contain)
		.accessibilityIdentifier("skill.chip")
	}
}
