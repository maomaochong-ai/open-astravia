import SwiftUI
import VettaKit

/// The task board in brief on New Session, laid out unevenly: the top card tall on the
/// left; on the right the second card over a pill with the totals that opens the board.
/// Each card opens the session it shows. Draws nothing while the board is empty.
struct BoardSummary: View {
	@Environment(AppModel.self) private var model
	@Environment(Router.self) private var router
	/// `TaskBoard.cards`, worked out once by the page.
	var cards: [TaskBoardCard]
	var avatarAsleep: Bool

	private static let height: CGFloat = 196
	private static let spacing: CGFloat = 10

	var body: some View {
		if let first = cards.first {
			VStack(alignment: .leading, spacing: 14) {
				HStack(spacing: 10) {
					BotAvatar(size: 24, asleep: avatarAsleep, blinksOnAppear: 3)
					Text(L10n.Home.taskBoard)
						.font(.headline)
						.foregroundStyle(Theme.ink)
				}
				// The height is fixed, so reading the width costs no layout pass of its own.
				GeometryReader { proxy in
					HStack(alignment: .top, spacing: Self.spacing) {
						SummaryCard(card: first, titleLines: 4)
							.frame(maxWidth: .infinity, maxHeight: .infinity)
						VStack(spacing: Self.spacing) {
							if cards.count > 1 {
								SummaryCard(card: cards[1], titleLines: 2)
									.frame(maxHeight: .infinity)
							}
							totals.frame(maxHeight: cards.count > 1 ? 52 : .infinity)
						}
						.frame(width: (proxy.size.width - Self.spacing) * 0.44)
					}
				}
				.frame(height: Self.height)
			}
			// Kept sessions are shown before the desktop answers, a little faded.
			.opacity(model.online ? 1 : 0.6)
			.animation(.snappy, value: model.online)
		}
	}

	private var totals: some View {
		let waiting = model.count(.waiting)
		let running = model.count(.processing)
		return Button { router.openBoard() } label: {
			HStack(spacing: 12) {
				if waiting == 0, running == 0 {
					Text(L10n.Board.viewAll).font(.subheadline.weight(.medium))
				}
				if waiting > 0 { CountBadge(status: .waitingInput, count: waiting) }
				if running > 0 { CountBadge(status: .running, count: running) }
				Spacer(minLength: 0)
				Image(systemName: "chevron.right").font(.subheadline.weight(.semibold))
			}
			.foregroundStyle(Theme.ink)
			.padding(.horizontal, 16)
			.frame(maxWidth: .infinity, maxHeight: .infinity)
			.background(Theme.card2, in: .rect(cornerRadius: 26, style: .continuous))
			.contentShape(.rect(cornerRadius: 26, style: .continuous))
		}
		.buttonStyle(.plain)
		.accessibilityLabel(L10n.Home.taskBoard)
		.accessibilityValue([
			waiting > 0 ? "\(waiting) \(L10n.Home.groupWaiting)" : nil,
			running > 0 ? "\(running) \(L10n.Home.groupProcessing)" : nil,
		].compactMap(\.self).joined(separator: ", "))
		.accessibilityIdentifier("newSession.board")
	}
}

/// A board card in brief: where it is, its most pressing session's title, and a round
/// status badge in the corner. Opens that session.
private struct SummaryCard: View {
	@Environment(Router.self) private var router
	var card: TaskBoardCard
	var titleLines: Int

	private var lead: RemoteSessionSummary? { card.sessions.first }

	var body: some View {
		Button { if let lead { router.show(lead.id) } } label: {
			VStack(alignment: .leading, spacing: 6) {
				Text(card.isConversation ? L10n.Home.conversation : card.name)
					.font(.caption.weight(.medium))
					.foregroundStyle(Theme.dim)
					.lineLimit(1)
				Text(title)
					.font(.body.weight(.medium))
					.foregroundStyle(Theme.ink)
					.lineLimit(titleLines)
					.multilineTextAlignment(.leading)
				Spacer(minLength: 0)
				badge
			}
			.padding(14)
			.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
			.background(Theme.card2, in: .rect(cornerRadius: 22, style: .continuous))
			.contentShape(.rect(cornerRadius: 22, style: .continuous))
		}
		.buttonStyle(.plain)
		.accessibilityIdentifier("newSession.boardCard")
	}

	private var title: String {
		guard let lead, !lead.title.trimmingCharacters(in: .whitespaces).isEmpty else { return L10n.Home.untitled }
		return lead.title
	}

	@ViewBuilder
	private var badge: some View {
		if card.waiting > 0 {
			CountBadge(status: .waitingInput, count: card.waiting, round: true)
		} else if card.running > 0 {
			CountBadge(status: .running, count: card.running, round: true)
		} else {
			Image(systemName: "checkmark")
				.font(.caption.weight(.bold))
				.foregroundStyle(Theme.dim)
				.frame(width: 32, height: 32)
				.background(Theme.page.opacity(0.6), in: .circle)
		}
	}
}

/// A status glyph with how many sessions are in it; `round` sets the glyph in a circle.
private struct CountBadge: View {
	var status: RemoteSessionStatus
	var count: Int
	var round = false

	var body: some View {
		HStack(spacing: 6) {
			if let glyph = StatusGlyph(status: status) {
				glyph
					.font(.caption.weight(.bold))
					.frame(width: round ? 32 : nil, height: round ? 32 : nil)
					.background(round ? Theme.page.opacity(0.6) : .clear, in: .circle)
			}
			Text("\(count)")
				.font(.subheadline.weight(.semibold).monospacedDigit())
				.foregroundStyle(Theme.ink)
		}
	}
}
