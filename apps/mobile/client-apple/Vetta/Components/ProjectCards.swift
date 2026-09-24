import SwiftUI
import VettaKit

/// One recent project on Home: its name and count, its two latest sessions, and a way in,
/// in the app's own black, white and grey.
struct ProjectCard: View {
	@Environment(Router.self) private var router
	var project: ProjectDigest

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			HStack(spacing: 10) {
				Image(systemName: projectSymbol)
					.font(.body.weight(.semibold))
				Text(project.name)
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
					Button { router.path.append(.session(session.id)) } label: { row(session) }
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
		.onTapGesture { router.path.append(.project(project.cwd)) }
		.accessibilityAction(named: L10n.Home.openProject) { router.path.append(.project(project.cwd)) }
		.accessibilityIdentifier("project.card.\(project.cwd)")
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

/// The horizontal strip of recent project cards, snapping card by card with the next one peeking in.
struct ProjectCarousel: View {
	var projects: [ProjectDigest]

	var body: some View {
		ScrollView(.horizontal) {
			HStack(alignment: .top, spacing: 14) {
				ForEach(projects) { project in
					ProjectCard(project: project)
						.containerRelativeFrame(.horizontal) { width, _ in
							projects.count == 1 ? width - 32 : width - 32 - 36
						}
				}
			}
			.scrollTargetLayout()
		}
		.contentMargins(.horizontal, 16, for: .scrollContent)
		.scrollTargetBehavior(.viewAligned)
		.scrollIndicators(.hidden)
		.scrollClipDisabled()
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
