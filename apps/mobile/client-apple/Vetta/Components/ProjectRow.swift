import SwiftUI
import VettaKit

/// A project in search results.
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
