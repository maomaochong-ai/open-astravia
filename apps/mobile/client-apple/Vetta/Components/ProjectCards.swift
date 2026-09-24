import SwiftUI
import VettaKit

/// The three colour blocks of Home's recent projects, by position: first blue,
/// then purple, then green. Brand colours, the same in light and dark mode.
struct CardPalette {
	var gradient: [Color]
	var ink: Color
	var secondaryInk: Color
	var rowFill: Color
	var line: Color
	var badgeFill: Color
	var badgeInk: Color
	/// The arrow button.
	var accentFill: Color
	var accentInk: Color
	/// The disc behind a session's status glyph; waiting is always yellow.
	var statusFill: Color
	/// `nil` colours each glyph by its status, for the white discs on blue.
	var statusInk: Color?

	static let all = [blue, purple, green]

	static func at(_ index: Int) -> CardPalette { all[index % all.count] }

	static let blue = CardPalette(
		gradient: [Color(rgb: 0x12B8FF), Color(rgb: 0x2F5BFF)],
		ink: .white,
		secondaryInk: .white.opacity(0.78),
		rowFill: .white.opacity(0.16),
		line: .white.opacity(0.28),
		badgeFill: .white.opacity(0.28),
		badgeInk: .white,
		accentFill: .white,
		accentInk: Color(rgb: 0x2F5BFF),
		statusFill: .white,
		statusInk: nil
	)

	static let purple = CardPalette(
		gradient: [Color(rgb: 0xD9C2FA), Color(rgb: 0xB18CF0)],
		ink: Color(rgb: 0x25164A),
		secondaryInk: Color(rgb: 0x25164A).opacity(0.7),
		rowFill: .white.opacity(0.22),
		line: Color(rgb: 0x25164A).opacity(0.14),
		badgeFill: Color(rgb: 0x2E1D5C),
		badgeInk: .white,
		accentFill: Color(rgb: 0x2E1D5C),
		accentInk: .white,
		statusFill: Color(rgb: 0x2E1D5C),
		statusInk: .white
	)

	static let green = CardPalette(
		gradient: [Color(rgb: 0x6BE8BC), Color(rgb: 0x10C6A2)],
		ink: Color(rgb: 0x04221A),
		secondaryInk: Color(rgb: 0x04221A).opacity(0.72),
		rowFill: .white.opacity(0.2),
		line: Color(rgb: 0x04221A).opacity(0.14),
		badgeFill: .black,
		badgeInk: .white,
		accentFill: .black,
		accentInk: .white,
		statusFill: .black,
		statusInk: .white
	)
}

extension Color {
	init(rgb: UInt32) {
		self.init(uiColor: UIColor(rgb: rgb))
	}
}

/// One recent project on Home: its name and count, its two latest sessions, and a way in.
struct ProjectCard: View {
	@Environment(Router.self) private var router
	var project: ProjectDigest
	var palette: CardPalette

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
					.foregroundStyle(palette.badgeInk)
					.padding(.horizontal, 10)
					.padding(.vertical, 4)
					.background(palette.badgeFill, in: .capsule)
					.fixedSize()
			}
			.foregroundStyle(palette.ink)

			VStack(spacing: 8) {
				ForEach(project.recent) { session in
					Button { router.path.append(.session(session.id)) } label: { row(session) }
						.buttonStyle(.plain)
						.accessibilityIdentifier("project.session.\(session.id)")
				}
			}
			.padding(.top, 14)

			Rectangle().fill(palette.line).frame(height: 1).padding(.top, 16)

			HStack {
				Text(L10n.Home.updated(TimeFormat.relative(project.updatedAt)))
					.font(.subheadline.weight(.medium))
					.foregroundStyle(palette.secondaryInk)
				Spacer(minLength: 8)
				Image(systemName: "arrow.right")
					.font(.headline)
					.foregroundStyle(palette.accentInk)
					.frame(width: 38, height: 38)
					.background(palette.accentFill, in: .circle)
			}
			.padding(.top, 12)
		}
		.padding(18)
		.frame(maxHeight: .infinity, alignment: .top)
		.background(
			LinearGradient(colors: palette.gradient, startPoint: .topLeading, endPoint: .bottomTrailing),
			in: .rect(cornerRadius: 26, style: .continuous)
		)
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
				.foregroundStyle(palette.ink)
				.lineLimit(1)
			Spacer(minLength: 8)
			Text(TimeFormat.relative(session.updatedAt))
				.font(.footnote)
				.foregroundStyle(palette.secondaryInk)
				.fixedSize()
		}
		.padding(.horizontal, 12)
		.frame(height: 44)
		.background(palette.rowFill, in: .rect(cornerRadius: 16, style: .continuous))
		.contentShape(.rect(cornerRadius: 16))
	}

	private func statusDisc(_ status: RemoteSessionStatus) -> some View {
		let waiting = status == .waitingInput
		return StatusGlyph(status: status)
			.font(.system(size: 11, weight: .heavy))
			.foregroundStyle(waiting ? .black : palette.statusInk ?? Self.tint(status))
			.frame(width: 24, height: 24)
			.background(waiting ? Theme.yellow : palette.statusFill, in: .circle)
	}

	private static func tint(_ status: RemoteSessionStatus) -> Color {
		switch status {
		case .running, .thinking: Theme.blue
		case .error: Theme.red
		default: Theme.green
		}
	}
}

/// The horizontal strip of recent project cards, snapping card by card with the next one peeking in.
struct ProjectCarousel: View {
	var projects: [ProjectDigest]

	var body: some View {
		ScrollView(.horizontal) {
			HStack(alignment: .top, spacing: 14) {
				ForEach(Array(projects.enumerated()), id: \.element.id) { index, project in
					ProjectCard(project: project, palette: .at(index))
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
