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

/// Shown on Work until a desktop is paired.
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

/// The computer icon next to the Work title; tapping it explains the link and offers a reconnect.
struct LinkStatusButton: View {
	@Environment(AppModel.self) private var model
	var compact = false
	@State private var open = false

	var body: some View {
		let indicator = LinkIndicator(model.link)
		Button { open = true } label: {
			Image(systemName: indicator == .offline ? "laptopcomputer.slash" : "laptopcomputer")
				.font(compact ? .subheadline.weight(.semibold) : .title3.weight(.semibold))
				.foregroundStyle(color(indicator))
				.symbolEffect(.pulse, isActive: indicator.isConnecting)
				.contentTransition(.symbolEffect(.replace))
		}
		.buttonStyle(.plain)
		.accessibilityLabel(L10n.Link.status)
		.accessibilityValue(describe(indicator))
		.accessibilityIdentifier(compact ? "link.status.compact" : "link.status")
		.popover(isPresented: $open) {
			VStack(alignment: .leading, spacing: 12) {
				VStack(alignment: .leading, spacing: 2) {
					Text(describe(indicator)).font(.headline)
					if indicator == .online, let detail {
						Text(detail).font(.subheadline).foregroundStyle(.secondary)
					}
				}
				if indicator == .offline {
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

	private var detail: String? {
		guard let channel = model.link.channel else { return nil }
		let via = channel == .lan ? L10n.Settings.viaLan : L10n.Settings.viaRelay
		guard let rtt = model.link.rttMs, rtt > 0 else { return via }
		return "\(via) · \(L10n.Link.latency(Int(rtt.rounded())))"
	}

	private func color(_ indicator: LinkIndicator) -> Color {
		switch indicator {
		case .online: Theme.green
		case .connecting, .reconnecting: .secondary
		case .offline: Theme.red
		}
	}

	private func describe(_ indicator: LinkIndicator) -> String {
		switch indicator {
		case .online: L10n.Link.connected
		case .connecting: L10n.Link.connecting
		case let .reconnecting(attempt): L10n.Link.reconnecting(attempt)
		case .offline: L10n.Common.offline
		}
	}
}

extension LinkIndicator {
	var isConnecting: Bool {
		switch self {
		case .connecting, .reconnecting: true
		default: false
		}
	}
}

/// A session's state in a list row's avatar slot, the way Mail shows the sender:
/// a coloured disc with one glyph. Only the states that want a look move.
struct StatusAvatar: View {
	var status: RemoteSessionStatus
	var size: CGFloat = 40

	var body: some View {
		let look = Self.look(status)
		Circle()
			.fill(look.fill)
			.frame(width: size, height: size)
			.overlay { glyph(look) }
			.accessibilityElement()
			.accessibilityLabel(look.label)
	}

	@ViewBuilder
	private func glyph(_ look: Look) -> some View {
		let image = Image(systemName: look.symbol)
			.font(.system(size: size * 0.42, weight: .bold))
			.foregroundStyle(look.ink)
		switch status {
		case .running, .thinking:
			image.symbolEffect(.rotate, options: .repeat(.continuous))
		case .waitingInput:
			image.symbolEffect(.bounce.up, options: .repeat(.periodic(delay: 1)))
		case .idle, .completed, .error, .aborted:
			image
		}
	}

	private struct Look {
		var symbol: String
		var fill: Color
		var ink: Color = .white
		var label: String
	}

	private static func look(_ status: RemoteSessionStatus) -> Look {
		switch status {
		case .running: Look(symbol: "arrow.triangle.2.circlepath", fill: Theme.blue, label: L10n.Home.statusRunning)
		case .thinking: Look(symbol: "arrow.triangle.2.circlepath", fill: Theme.blue, label: L10n.Home.statusThinking)
		// Dark ink: white would wash out on yellow.
		case .waitingInput: Look(symbol: "questionmark", fill: Theme.yellow, ink: .black, label: L10n.Home.statusWaiting)
		case .error: Look(symbol: "exclamationmark", fill: Theme.red, label: L10n.Home.statusError)
		case .aborted: Look(symbol: "stop.fill", fill: Theme.faint, label: L10n.Home.statusAborted)
		case .idle, .completed: Look(symbol: "checkmark", fill: Theme.green, label: L10n.Home.statusDone)
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
