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

/// A session's state as a small tinted capsule, e.g. on a list row.
struct StatusBadge: View {
	var status: RemoteSessionStatus

	var body: some View {
		let (label, tone) = describeStatus(status)
		HStack(spacing: 4) {
			switch status {
			case .running, .thinking:
				ProgressView().controlSize(.mini).tint(tone.color)
			case .waitingInput:
				Image(systemName: "questionmark.circle.fill")
			case .error:
				Image(systemName: "exclamationmark.triangle.fill")
			case .aborted:
				Image(systemName: "stop.circle")
			case .idle, .completed:
				EmptyView()
			}
			Text(label)
		}
		.font(.caption.weight(.medium))
		.foregroundStyle(tone.color)
		.padding(.horizontal, 8)
		.padding(.vertical, 3)
		.background(tone.color.opacity(0.15), in: .capsule)
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
