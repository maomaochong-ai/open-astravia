import SwiftUI
import VettaKit

/// Every project with work under way, and the most recent ones, as a two-column waterfall
/// of cards ranked by `TaskBoard`: what waits on the user first, then what runs, then the rest.
struct TaskBoardView: View {
	@Environment(AppModel.self) private var model
	@Environment(Router.self) private var router
	@State private var deleting: RemoteSessionSummary?

	var body: some View {
		let cards = TaskBoard.cards(model.sessions, conversationCwd: model.conversationCwd)
		ScrollView {
			VStack(alignment: .leading, spacing: 12) {
				// Before the first answer the cards may be out of date.
				if !model.online, !cards.isEmpty {
					Label(L10n.Board.stale, systemImage: "clock.arrow.circlepath")
						.font(.footnote)
						.foregroundStyle(Theme.dim)
						.padding(.horizontal, 4)
				}
				HStack(alignment: .top, spacing: 12) {
					ForEach(Array(TaskBoard.columns(cards, count: 2).enumerated()), id: \.offset) { _, column in
						LazyVStack(spacing: 12) {
							ForEach(column) { card in
								BoardCard(card: card, deleting: $deleting)
							}
						}
						.frame(maxWidth: .infinity, alignment: .top)
					}
				}
				if cards.isEmpty {
					if model.sessionsLoaded || LinkIndicator(model.link) == .offline { emptyState }
				} else {
					allSessions
				}
			}
			.padding(.horizontal, 16)
			.padding(.bottom, 24)
		}
		.background { Theme.page.ignoresSafeArea() }
		// Cards move to their new rank rather than jump.
		.animation(.snappy, value: cards.map(\.id))
		.animation(.snappy, value: cards.flatMap { $0.sessions.map(\.id) })
		.refreshable { await model.refreshSessions() }
		.sessionDeleteDialog($deleting, model: model)
		.navigationTitle(L10n.Home.taskBoard)
		.navigationBarTitleDisplayMode(.large)
	}

	private var emptyState: some View {
		VStack(spacing: 14) {
			BotAvatar(size: 44, asleep: LinkIndicator(model.link) == .offline)
			Text(L10n.Board.empty)
				.font(.title3.weight(.semibold))
				.foregroundStyle(Theme.ink)
			Text(L10n.Board.emptyDescription)
				.font(.subheadline)
				.foregroundStyle(Theme.dim)
				.multilineTextAlignment(.center)
			Button(L10n.NewSession.title, systemImage: "square.and.pencil") { router.startNewSession() }
				.buttonStyle(.glass)
				.padding(.top, 4)
		}
		.frame(maxWidth: .infinity)
		.padding(.top, 80)
		.padding(.horizontal, 24)
	}

	/// Older projects are left to Home's list, which filters by project.
	private var allSessions: some View {
		Button { router.path.removeAll() } label: {
			HStack(spacing: 4) {
				Text(L10n.Home.allSessions)
				Image(systemName: "chevron.right").font(.caption.weight(.semibold))
			}
			.font(.subheadline.weight(.medium))
			.foregroundStyle(Theme.dim)
			.frame(maxWidth: .infinity)
			.padding(.vertical, 12)
			.contentShape(.rect)
		}
		.buttonStyle(.plain)
		.accessibilityIdentifier("board.allSessions")
	}
}

/// One project, or the conversations, on the board: its name, then its sessions,
/// each opening its chat; a project's name opens its page.
private struct BoardCard: View {
	@Environment(AppModel.self) private var model
	@Environment(Router.self) private var router
	var card: TaskBoardCard
	@Binding var deleting: RemoteSessionSummary?

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			header
			VStack(spacing: 6) {
				ForEach(card.sessions) { session in
					row(session)
				}
			}
			if card.hidden > 0 { more }
		}
		.padding(12)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(Theme.card2, in: .rect(cornerRadius: 20, style: .continuous))
		.accessibilityIdentifier("board.card.\(card.name)")
	}

	@ViewBuilder
	private var header: some View {
		let label = HStack(spacing: 5) {
			Image(systemName: card.isConversation ? "bubble.left" : projectSymbol)
				.font(.caption.weight(.semibold))
			Text(card.isConversation ? L10n.Home.conversation : card.name)
				.font(.subheadline.weight(.semibold))
				.lineLimit(1)
			if !card.isConversation {
				Spacer(minLength: 0)
				Image(systemName: "chevron.right").font(.caption2.weight(.bold)).foregroundStyle(Theme.faint)
			}
		}
		.foregroundStyle(Theme.ink)
		.padding(.horizontal, 4)
		.padding(.bottom, 2)
		// The conversations have no page of their own since that list was dropped.
		if card.isConversation {
			label.accessibilityAddTraits(.isHeader)
		} else {
			Button { router.path.append(.project(card.cwd)) } label: { label.contentShape(.rect) }
				.buttonStyle(.plain)
		}
	}

	private func row(_ session: RemoteSessionSummary) -> some View {
		let status = StatusGlyph(status: session.status)
		let title = BoardSessionChip.title(session)
		return Button { router.show(session.id) } label: {
			BoardSessionChip(session: session, lineLimit: 2)
		}
		.buttonStyle(.plain)
		.accessibilityLabel([title, status?.label].compactMap(\.self).joined(separator: ", "))
		.accessibilityIdentifier("session.\(session.id)")
		.contextMenu {
			Button(session.pinned ? L10n.Session.unpin : L10n.Session.pin, systemImage: session.pinned ? "pin.slash" : "pin") {
				Task { await model.setPinned(session.id, !session.pinned) }
			}
			Button(L10n.Session.delete, systemImage: "trash", role: .destructive) {
				deleting = session
			}
		}
	}

	@ViewBuilder
	private var more: some View {
		let text = Text(L10n.Board.more(card.hidden))
			.font(.caption.weight(.medium))
			.foregroundStyle(Theme.dim)
			.padding(.horizontal, 4)
		if card.isConversation {
			text
		} else {
			Button { router.path.append(.project(card.cwd)) } label: { text }
				.buttonStyle(.plain)
		}
	}
}

/// A session on a board card, on its own tinted strip: status, then the title. Waiting
/// sessions are warmed, as in Home's list. Only the label; callers make it a button.
struct BoardSessionChip: View {
	var session: RemoteSessionSummary
	var lineLimit: Int

	static func title(_ session: RemoteSessionSummary) -> String {
		session.title.trimmingCharacters(in: .whitespaces).isEmpty ? L10n.Home.untitled : session.title
	}

	var body: some View {
		HStack(alignment: .firstTextBaseline, spacing: 7) {
			Group {
				if let status = StatusGlyph(status: session.status) {
					status.font(.caption2.weight(.bold))
				} else {
					Circle().fill(Theme.faint).frame(width: 5, height: 5)
				}
			}
			.frame(width: 14)
			Text(Self.title(session))
				.font(.subheadline)
				.foregroundStyle(Theme.ink)
				.lineLimit(lineLimit)
				.multilineTextAlignment(.leading)
			Spacer(minLength: 0)
		}
		.padding(.horizontal, 8)
		.padding(.vertical, 7)
		.background(Theme.card, in: .rect(cornerRadius: 12, style: .continuous))
		.overlay {
			if session.status == .waitingInput {
				RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.yellow.opacity(0.12))
			}
		}
		.contentShape(.rect(cornerRadius: 12, style: .continuous))
	}
}
