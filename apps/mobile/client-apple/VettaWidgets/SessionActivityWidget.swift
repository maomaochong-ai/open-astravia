import ActivityKit
import SwiftUI
import VettaKit
import WidgetKit

/// Lock Screen and Dynamic Island: the session that leads (a question first,
/// otherwise the newest busy one), how long it has been at it, and how many more
/// there are. Tapping opens that session.
struct SessionActivityWidget: Widget {
	var body: some WidgetConfiguration {
		ActivityConfiguration(for: SessionActivityAttributes.self) { context in
			LockScreenView(digest: context.state, stale: context.isStale)
				.padding(16)
				.widgetURL(link(context.state))
		} dynamicIsland: { context in
			let digest = context.state
			return DynamicIsland {
				DynamicIslandExpandedRegion(.leading) {
					StatusIcon(digest: digest).font(.title2).padding(.leading, 4)
				}
				DynamicIslandExpandedRegion(.trailing) {
					Elapsed(digest: digest).font(.headline).padding(.trailing, 4)
				}
				DynamicIslandExpandedRegion(.bottom) {
					Summary(digest: digest, stale: context.isStale)
				}
			} compactLeading: {
				StatusIcon(digest: digest)
			} compactTrailing: {
				if digest.waiting > 0 {
					Text(verbatim: "\(digest.waiting)").foregroundStyle(.yellow).monospacedDigit()
				} else {
					Elapsed(digest: digest).frame(maxWidth: 44)
				}
			} minimal: {
				StatusIcon(digest: digest)
			}
			.widgetURL(link(digest))
		}
	}

	private func link(_ digest: LiveDigest) -> URL? {
		digest.headline.map { SessionLink.url($0.sessionId) }
	}
}

private struct LockScreenView: View {
	let digest: LiveDigest
	let stale: Bool

	var body: some View {
		HStack(alignment: .center, spacing: 12) {
			StatusIcon(digest: digest).font(.title)
			Summary(digest: digest, stale: stale)
			Spacer(minLength: 0)
			Elapsed(digest: digest).font(.title3.weight(.semibold))
		}
	}
}

private struct Summary: View {
	let digest: LiveDigest
	let stale: Bool

	var body: some View {
		VStack(alignment: .leading, spacing: 2) {
			Text(digest.headline?.title ?? L10n.Activity.allDone)
				.font(.headline)
				.lineLimit(1)
			Text(stale ? L10n.Activity.stale : status)
				.font(.subheadline)
				.foregroundStyle(.secondary)
				.lineLimit(1)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	private var status: String {
		guard let headline = digest.headline else { return "" }
		let state = headline.waiting ? L10n.Activity.waiting : L10n.Activity.running
		let others = digest.waiting + digest.running - 1
		return others > 0 ? "\(state) · \(L10n.Activity.others(others))" : state
	}
}

private struct StatusIcon: View {
	let digest: LiveDigest

	var body: some View {
		switch digest.headline {
		case let .some(headline) where headline.waiting:
			Image(systemName: "questionmark.bubble.fill").foregroundStyle(.yellow)
		case .some:
			Image(systemName: "sparkles").foregroundStyle(.blue)
		case .none:
			Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
		}
	}
}

/// Counts up on its own, so it stays right while the app is suspended.
private struct Elapsed: View {
	let digest: LiveDigest

	var body: some View {
		if let headline = digest.headline {
			Text(timerInterval: Date(timeIntervalSince1970: headline.since / 1000) ... .distantFuture, countsDown: false)
				.monospacedDigit()
				.multilineTextAlignment(.trailing)
		}
	}
}
