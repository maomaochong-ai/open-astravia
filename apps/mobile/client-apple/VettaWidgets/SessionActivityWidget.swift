import ActivityKit
import SwiftUI
import VettaKit
import WidgetKit

/// Lock Screen and Dynamic Island: the session that leads (a question first,
/// otherwise the newest busy one), how long it has been at it, and how many more
/// there are. Tapping opens that session; a simple question is answered right
/// there with one button per choice.
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
					VStack(alignment: .leading, spacing: 8) {
						Summary(digest: digest, stale: context.isStale)
						if !context.isStale { Choices(digest: digest) }
					}
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
		VStack(alignment: .leading, spacing: 12) {
			HStack(alignment: .center, spacing: 12) {
				StatusIcon(digest: digest).font(.title)
				Summary(digest: digest, stale: stale)
				Spacer(minLength: 0)
				Elapsed(digest: digest).font(.title3.weight(.semibold))
			}
			// A stale question may have been answered elsewhere already.
			if !stale { Choices(digest: digest) }
		}
	}
}

/// The question and a button per choice, when it can be answered with one tap.
private struct Choices: View {
	let digest: LiveDigest

	var body: some View {
		if let headline = digest.headline, headline.answering == nil, let question = headline.question {
			VStack(alignment: .leading, spacing: 8) {
				Text(question.text)
					.font(.subheadline)
					.lineLimit(2)
				HStack(spacing: 8) {
					ForEach(Array(question.options.enumerated()), id: \.offset) { index, option in
						Button(intent: AnswerQuestionIntent(sessionId: headline.sessionId, requestId: question.requestId, question: question.question, choice: option)) {
							Text(option)
								.font(.subheadline.weight(.semibold))
								.lineLimit(1)
								.frame(maxWidth: .infinity)
						}
						.buttonStyle(.bordered)
						.tint(index == 0 ? .yellow : .gray)
					}
				}
			}
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
		if let choice = headline.answering { return L10n.Activity.answering(choice) }
		// Several questions, several choices at once, or not yet known here.
		if headline.waiting, headline.question == nil { return L10n.Activity.openToAnswer }
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
