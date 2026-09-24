import SwiftUI
import VettaKit

/// The task board in brief on New Session, laid out unevenly: the top card tall on the
/// left with its first sessions; on the right the second card over a pill with the totals
/// that opens the board. Each session shown opens its chat. Draws nothing while the board is empty.
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
						SummaryCard(card: first, rows: 3)
							.frame(maxWidth: .infinity, maxHeight: .infinity)
						VStack(spacing: Self.spacing) {
							if cards.count > 1 {
								SummaryCard(card: cards[1], rows: 0)
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

/// A board card in brief: where it is, then either its first few sessions, each opening
/// its chat, or, where there is no room for a list, the most pressing one's title with the
/// whole card opening it; a round status badge sits in the corner.
private struct SummaryCard: View {
	@Environment(Router.self) private var router
	var card: TaskBoardCard
	/// Sessions listed; 0 shows only the most pressing one's title.
	var rows: Int

	private var lead: RemoteSessionSummary? { card.sessions.first }

	var body: some View {
		if rows > 0 {
			content {
				VStack(spacing: 5) {
					ForEach(card.sessions.prefix(rows)) { session in
						Button { router.show(session.id) } label: {
							BoardSessionChip(session: session, lineLimit: 1)
						}
						.buttonStyle(.plain)
						.accessibilityLabel(BoardSessionChip.title(session))
					}
				}
			}
			.accessibilityElement(children: .contain)
		} else {
			Button { if let lead { router.show(lead.id) } } label: {
				content {
					Text(lead.map(BoardSessionChip.title) ?? L10n.Home.untitled)
						.font(.body.weight(.medium))
						.foregroundStyle(Theme.ink)
						.lineLimit(2)
						.multilineTextAlignment(.leading)
				}
				.contentShape(.rect(cornerRadius: 22, style: .continuous))
			}
			.buttonStyle(.plain)
			.accessibilityIdentifier("newSession.boardCard")
		}
	}

	private func content(@ViewBuilder _ body: () -> some View) -> some View {
		VStack(alignment: .leading, spacing: 8) {
			Text(card.isConversation ? L10n.Home.conversation : card.name)
				.font(.caption.weight(.medium))
				.foregroundStyle(Theme.dim)
				.lineLimit(1)
			body()
			Spacer(minLength: 0)
			badge
		}
		.padding(14)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.background(Theme.card2, in: .rect(cornerRadius: 22, style: .continuous))
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
