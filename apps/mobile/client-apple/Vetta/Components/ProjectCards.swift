import SwiftUI
import VettaKit

/// One recent project on Home: its name and count, its two latest sessions, and a way in,
/// in the app's own black, white and grey. The conversations card looks the same.
struct ProjectCard: View {
	@Environment(Router.self) private var router
	var project: ProjectDigest
	var isConversation = false

	private var route: Route { isConversation ? .conversations : .project(project.cwd) }

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			HStack(spacing: 10) {
				Image(systemName: isConversation ? "bubble.left" : projectSymbol)
					.font(.body.weight(.semibold))
				Text(isConversation ? L10n.Home.conversation : project.name)
					.font(.title3.bold())
					.lineLimit(1)
				Spacer(minLength: 8)
				Text(L10n.Home.sessionCount(project.sessionCount))
					.font(.subheadline.weight(.semibold))
					.foregroundStyle(Theme.ink2)
					.padding(.horizontal, 10)
					.padding(.vertical, 4)
					.background(Theme.card2, in: .capsule)
					.fixedSize()
			}
			.foregroundStyle(Theme.ink)

			VStack(spacing: 8) {
				ForEach(project.recent) { session in
					Button { router.show(session.id) } label: { row(session) }
						.buttonStyle(.plain)
						.accessibilityIdentifier("project.session.\(session.id)")
				}
			}
			.padding(.top, 14)

			Rectangle().fill(Theme.line).frame(height: 1).padding(.top, 16)

			HStack {
				Text(L10n.Home.updated(TimeFormat.relative(project.updatedAt)))
					.font(.subheadline.weight(.medium))
					.foregroundStyle(Theme.dim)
				Spacer(minLength: 8)
				Image(systemName: "arrow.right")
					.font(.headline)
					.foregroundStyle(Theme.pillInk)
					.frame(width: 38, height: 38)
					.background(Theme.pill, in: .circle)
			}
			.padding(.top, 12)
		}
		.padding(18)
		.frame(maxHeight: .infinity, alignment: .top)
		.background(Theme.card, in: .rect(cornerRadius: 26, style: .continuous))
		.overlay { RoundedRectangle(cornerRadius: 26, style: .continuous).strokeBorder(Theme.line) }
		.contentShape(.rect(cornerRadius: 26))
		// Anywhere outside the session rows opens the project.
		.onTapGesture { router.path.append(route) }
		.accessibilityAction(named: L10n.Home.openProject) { router.path.append(route) }
		.accessibilityIdentifier(isConversation ? "project.card.conversations" : "project.card.\(project.cwd)")
	}

	private func row(_ session: RemoteSessionSummary) -> some View {
		HStack(spacing: 10) {
			statusDisc(session.status)
			Text(session.title.trimmingCharacters(in: .whitespaces).isEmpty ? L10n.Home.untitled : session.title)
				.font(.subheadline.weight(.semibold))
				.foregroundStyle(Theme.ink)
				.lineLimit(1)
			Spacer(minLength: 8)
			Text(TimeFormat.relative(session.updatedAt))
				.font(.footnote)
				.foregroundStyle(Theme.dim)
				.fixedSize()
		}
		.padding(.horizontal, 12)
		.frame(height: 44)
		.background(Theme.card2, in: .rect(cornerRadius: 16, style: .continuous))
		.contentShape(.rect(cornerRadius: 16))
	}

	/// The status in its own colour on a soft disc of it, like the session tags; the card itself stays neutral.
	private func statusDisc(_ status: RemoteSessionStatus) -> some View {
		let tint = Self.tint(status)
		return StatusGlyph(status: status)
			.font(.system(size: 11, weight: .heavy))
			.foregroundStyle(tint)
			.frame(width: 24, height: 24)
			.background(tint.opacity(0.16), in: .circle)
	}

	private static func tint(_ status: RemoteSessionStatus) -> Color {
		switch status {
		case .waitingInput: Theme.yellow
		case .running, .thinking: Theme.blue
		case .error: Theme.red
		case .idle, .completed, .aborted: Theme.green
		}
	}
}

/// The horizontal strip of recent cards, the conversations first and then the projects,
/// snapping card by card with the next one peeking in.
struct ProjectCarousel: View {
	var conversations: ProjectDigest?
	var projects: [ProjectDigest]

	private var count: Int { projects.count + (conversations == nil ? 0 : 1) }

	var body: some View {
		ScrollView(.horizontal) {
			HStack(alignment: .top, spacing: 14) {
				if let conversations {
					ProjectCard(project: conversations, isConversation: true).containerRelativeFrame(.horizontal, alignment: .leading, width)
				}
				ForEach(projects) { project in
					ProjectCard(project: project).containerRelativeFrame(.horizontal, alignment: .leading, width)
				}
			}
			.scrollTargetLayout()
		}
		.contentMargins(.horizontal, 16, for: .scrollContent)
		.scrollTargetBehavior(.viewAligned)
		.scrollIndicators(.hidden)
		.scrollClipDisabled()
	}

	/// A lone card takes the full width; otherwise the next one peeks in.
	private func width(_ length: CGFloat, _: Axis) -> CGFloat {
		count == 1 ? length - 32 : length - 32 - 36
	}
}

/// A project in All Projects and in search results.
struct ProjectRow: View {
	var project: ProjectDigest

	var body: some View {
		HStack(spacing: 14) {
			Image(systemName: projectSymbol)
				.font(.title3.weight(.medium))
				.foregroundStyle(Theme.ink2)
				.frame(width: 44, height: 44)
				.background(Theme.card2, in: .rect(cornerRadius: 12, style: .continuous))
			VStack(alignment: .leading, spacing: 2) {
				Text(project.name)
					.font(.headline)
					.foregroundStyle(Theme.ink)
					.lineLimit(1)
				Text(detail)
					.font(.subheadline)
					.foregroundStyle(Theme.dim)
					.lineLimit(1)
			}
		}
		.padding(.vertical, 4)
	}

	private var detail: String {
		let count = L10n.Home.sessionCount(project.sessionCount)
		guard project.updatedAt > 0 else { return count }
		return "\(count) · \(L10n.Home.updated(TimeFormat.relative(project.updatedAt)))"
	}
}
