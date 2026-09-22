import SwiftUI
import VettaKit

struct StatusDot: View {
	var color: Color
	var size: CGFloat = 7

	var body: some View {
		Circle().fill(color).frame(width: size, height: size)
	}
}

/// "Vetta" plus the link dot, used as the principal toolbar item.
struct TitleWithStatus: View {
	var title: String
	var subtitle: String?
	var online: Bool?

	var body: some View {
		VStack(spacing: 2) {
			HStack(spacing: 6) {
				Text(title).font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.ink)
				if let online {
					StatusDot(color: online ? Theme.green : Theme.faint)
						.accessibilityLabel(online ? L10n.Common.online : L10n.Common.offline)
				}
			}
			if let subtitle, !subtitle.isEmpty {
				Text(subtitle).font(.system(size: 12)).foregroundStyle(Theme.dim).lineLimit(1)
			}
		}
	}
}

enum PillTone {
	case neutral, green, orange
}

struct Pill: View {
	var text: String
	var tone: PillTone = .neutral

	var body: some View {
		Text(text)
			.font(.mono(11))
			.foregroundStyle(tone == .green ? Theme.green : tone == .orange ? Theme.orange : Theme.dim)
			.padding(.horizontal, 10)
			.padding(.vertical, 4)
			.background(Capsule().fill(tone == .green ? Theme.greenSoft : tone == .orange ? Theme.orangeSoft : Theme.card2))
	}
}

struct Banner: View {
	var text: String

	var body: some View {
		Text(text)
			.font(.system(size: 12))
			.foregroundStyle(Theme.dim)
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(.horizontal, 16)
			.padding(.vertical, 10)
			.glassEffect(.regular, in: .rect(cornerRadius: 16))
	}
}

enum StatusTone {
	case green, orange, dim, red

	var color: Color {
		switch self {
		case .green: Theme.green
		case .orange: Theme.orange
		case .red: Theme.red
		case .dim: Theme.dim
		}
	}
}

func describeStatus(_ status: RemoteSessionStatus) -> (label: String, tone: StatusTone) {
	switch status {
	case .running: (L10n.Home.statusRunning, .green)
	case .thinking: (L10n.Home.statusThinking, .green)
	case .waitingInput: (L10n.Home.statusWaiting, .orange)
	case .error: (L10n.Home.statusError, .red)
	case .aborted: (L10n.Home.statusAborted, .dim)
	case .idle, .completed: (L10n.Home.statusDone, .dim)
	}
}

/// Frosted bottom bar with a round send button, shared by the home and chat screens.
struct Composer: View {
	var placeholder: String
	var leadingIcon = false
	var disabled = false
	var busy = false
	var onStop: (() -> Void)?
	var onSend: (String) -> Void

	@State private var text = ""

	private var canSend: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !disabled }

	var body: some View {
		GlassEffectContainer(spacing: 10) {
			HStack(spacing: 10) {
				HStack(spacing: 10) {
					if leadingIcon {
						Image(systemName: "sparkles")
							.font(.system(size: 16, weight: .medium))
							.foregroundStyle(Theme.green)
					}
					TextField(placeholder, text: $text)
						.font(.system(size: 15))
						.foregroundStyle(Theme.ink)
						.submitLabel(.send)
						.onSubmit(submit)
						.disabled(disabled)
						.accessibilityIdentifier("composer.field")
				}
				.padding(.horizontal, 18)
				.frame(height: 50)
				.glassEffect(.regular.interactive(), in: .capsule)

				if busy, let onStop {
					Button(action: onStop) {
						Image(systemName: "stop.fill")
							.font(.system(size: 15, weight: .bold))
							.foregroundStyle(Theme.pillInk)
							.frame(width: 36, height: 36)
					}
					.buttonStyle(.glassProminent)
					.buttonBorderShape(.circle)
					.tint(Theme.pill)
					.accessibilityLabel(L10n.Chat.stop)
					.accessibilityIdentifier("composer.stop")
				} else {
					Button(action: submit) {
						Image(systemName: "arrow.up")
							.font(.system(size: 17, weight: .bold))
							.foregroundStyle(canSend ? Theme.pillInk : Theme.faint)
							.frame(width: 36, height: 36)
					}
					.buttonStyle(.glassProminent)
					.buttonBorderShape(.circle)
					.tint(canSend ? Theme.pill : Theme.card2)
					.disabled(!canSend)
					.accessibilityLabel(L10n.Chat.send)
					.accessibilityIdentifier("composer.send")
				}
			}
		}
		.padding(.horizontal, 16)
		.padding(.top, 8)
		.padding(.bottom, 8)
	}

	private func submit() {
		guard canSend else { return }
		let value = text
		text = ""
		onSend(value)
	}
}
