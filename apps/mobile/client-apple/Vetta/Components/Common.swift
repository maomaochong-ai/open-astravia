import SwiftUI
import VettaKit

struct StatusDot: View {
	var color: Color
	var size: CGFloat = 7

	var body: some View {
		Circle().fill(color).frame(width: size, height: size)
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

/// Shown on Home until a desktop is paired.
struct UnpairedView: View {
	@Environment(Router.self) private var router

	var body: some View {
		ContentUnavailableView {
			Label(L10n.Home.unpairedTitle, systemImage: "laptopcomputer.and.iphone")
		} description: {
			Text(L10n.Home.unpairedDescription)
		} actions: {
			Button(L10n.Home.unpairedScan) { router.showPairing = true }
				.buttonStyle(.glassProminent)
				.tint(Theme.pill)
				.foregroundStyle(Theme.pillInk)
				.accessibilityIdentifier("home.pair")
		}
	}
}

/// Home's top-left capsule: the computer and how the phone reaches it, always shown.
/// Tapping explains the link and offers a reconnect; unpaired, it opens pairing.
struct LinkPill: View {
	@Environment(AppModel.self) private var model
	@Environment(Router.self) private var router
	@State private var open = false

	private enum Phase: Equatable {
		case unpaired
		case link(LinkIndicator)
	}

	var body: some View {
		let state: Phase = model.paired ? .link(LinkIndicator(model.link)) : .unpaired
		Button {
			if state == .unpaired { router.showPairing = true } else { open = true }
		} label: {
			HStack(spacing: 7) {
				Image(systemName: state == .link(.offline) ? "laptopcomputer.slash" : "laptopcomputer")
					.contentTransition(.symbolEffect(.replace))
				mark(state)
			}
			.font(.headline)
			.foregroundStyle(ink(state))
			.padding(.horizontal, 16)
			.frame(height: 40)
			.background(fill(state), in: .capsule)
			.contentShape(.capsule)
			.animation(.snappy, value: state)
		}
		.buttonStyle(.plain)
		.accessibilityLabel(L10n.Link.status)
		.accessibilityValue(describe(state))
		.accessibilityIdentifier("link.status")
		.popover(isPresented: $open) {
			VStack(alignment: .leading, spacing: 12) {
				VStack(alignment: .leading, spacing: 2) {
					Text(describe(state)).font(.headline)
					if state == .link(.online), let detail {
						Text(detail).font(.subheadline).foregroundStyle(.secondary)
					}
				}
				if state == .link(.offline) {
					Button(L10n.Link.reconnect) {
						model.refreshLink()
						open = false
					}
					.buttonStyle(.glassProminent)
					.tint(Theme.pill)
					.foregroundStyle(Theme.pillInk)
				}
			}
			.padding(16)
			.presentationCompactAdaptation(.popover)
		}
	}

	@ViewBuilder
	private func mark(_ state: Phase) -> some View {
		switch state {
		case .unpaired:
			Image(systemName: "plus").fontWeight(.bold)
		case .link(.online):
			Image(systemName: "checkmark").fontWeight(.heavy).foregroundStyle(Theme.green)
		case .link(.connecting), .link(.reconnecting):
			ProgressView().controlSize(.small).tint(Theme.ink2)
		case .link(.offline):
			Image(systemName: "xmark").fontWeight(.heavy)
		}
	}

	private func fill(_ state: Phase) -> Color {
		switch state {
		case .link(.online): Theme.pill
		case .link(.offline): Theme.red.opacity(0.18)
		default: Theme.card2
		}
	}

	private func ink(_ state: Phase) -> Color {
		switch state {
		case .link(.online): Theme.pillInk
		case .link(.offline): Theme.red
		default: Theme.ink2
		}
	}

	private var detail: String? {
		guard let channel = model.link.channel else { return nil }
		let via = channel == .lan ? L10n.Settings.viaLan : L10n.Settings.viaRelay
		guard let rtt = model.link.rttMs, rtt > 0 else { return via }
		return "\(via) · \(L10n.Link.latency(Int(rtt.rounded())))"
	}

	private func describe(_ state: Phase) -> String {
		switch state {
		case .unpaired: L10n.Home.unpairedTitle
		case .link(.online): L10n.Link.connected
		case .link(.connecting): L10n.Link.connecting
		case let .link(.reconnecting(attempt)): L10n.Link.reconnecting(attempt)
		case .link(.offline): L10n.Common.offline
		}
	}
}

/// Puts the keyboard away, e.g. when the user taps outside the composer.
@MainActor func dismissKeyboard() {
	UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
}

/// Vetta's face, drawn like the desktop's `BotAvatar` in its black-and-white
/// theme: a rounded square with two round eyes cut out of it, so whatever is
/// behind shows through them. Asleep, the eyes close to slits.
/// Static on purpose; a tap blinks it once.
struct BotAvatar: View {
	var size: CGFloat = 24
	var asleep = false
	@State private var blinking = false

	var body: some View {
		let eye = size * 0.15
		RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
			.fill(LinearGradient(colors: [Theme.botFace, Theme.botFace.opacity(0.85)], startPoint: .topLeading, endPoint: .bottomTrailing))
			.frame(width: size, height: size)
			.mask {
				ZStack {
					Rectangle()
					HStack(spacing: eye) {
						ForEach(0 ..< 2, id: \.self) { _ in
							Circle()
								.frame(width: eye, height: eye)
								.scaleEffect(x: 1, y: asleep || blinking ? 0.15 : 1)
						}
					}
					.blendMode(.destinationOut)
				}
				.compositingGroup()
			}
			.shadow(color: Theme.botFace.opacity(0.3), radius: size * 0.2, y: size * 0.1)
			.animation(.easeInOut(duration: 0.15), value: blinking)
			.animation(.easeInOut(duration: 0.3), value: asleep)
			.onTapGesture {
				guard !asleep, !blinking else { return }
				blinking = true
				Task {
					try? await Task.sleep(for: .milliseconds(160))
					blinking = false
				}
			}
			.accessibilityHidden(true)
	}
}
