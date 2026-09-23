import SwiftUI
import VettaKit

private enum Filter: Hashable {
	case all, processing, done
}

struct HomeView: View {
	@Environment(AppModel.self) private var model
	@Environment(Router.self) private var router
	@State private var filter = Filter.all
	@State private var query = ""

	private var visible: [RemoteSessionSummary] {
		let base: [RemoteSessionSummary] = switch filter {
		case .all: model.sessions
		case .processing: model.sessions.filter { $0.status.isActive }
		case .done: model.sessions.filter { !$0.status.isActive }
		}
		let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
		let filtered = needle.isEmpty ? base : base.filter {
			$0.title.lowercased().contains(needle) || ($0.preview ?? "").lowercased().contains(needle)
		}
		return filtered.sorted { $0.updatedAt > $1.updatedAt }
	}

	var body: some View {
		if model.paired {
			sessionList
		} else {
			// Nothing to mirror until a desktop is paired, so the guide is the whole page.
			PairingGuide { router.showPairing = true }
				.opacity(model.ready ? 1 : 0)
				.navigationBarTitleDisplayMode(.inline)
				.toolbar {
					ToolbarItem(placement: .principal) {
						Text(L10n.appName).font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.ink)
					}
				}
		}
	}

	@ViewBuilder
	private var sessionList: some View {
		let rows = visible
		ScrollView {
			LazyVStack(alignment: .leading, spacing: 0) {
				header
				ForEach(Array(rows.enumerated()), id: \.element.id) { index, session in
					SessionRow(session: session, last: index == rows.count - 1) {
						router.path.append(.session(session.id))
					}
				}
				if rows.isEmpty {
					Text(model.sessions.isEmpty ? L10n.Home.empty : L10n.Home.emptyFiltered)
						.font(.system(size: 13))
						.foregroundStyle(Theme.dim)
						.frame(maxWidth: .infinity)
						.padding(.vertical, 56)
				}
			}
			.padding(.horizontal, 20)
			.padding(.bottom, 16)
		}
		.scrollDismissesKeyboard(.interactively)
		.refreshable { await model.refreshSessions() }
		.background(Theme.page)
		.safeAreaInset(edge: .bottom) {
			Composer(placeholder: L10n.Home.composerPlaceholder, leadingIcon: true, disabled: !model.online) { text in
				Task {
					if let id = await model.sendPrompt(nil, text) { router.path.append(.session(id)) }
				}
			}
		}
		.navigationBarTitleDisplayMode(.inline)
		.toolbar {
			ToolbarItem(placement: .topBarLeading) {
				Button { router.path.append(.settings) } label: {
					Image(systemName: "slider.horizontal.3")
				}
				.accessibilityLabel(L10n.Settings.title)
				.accessibilityIdentifier("home.settings")
			}
			ToolbarItem(placement: .principal) {
				TitleWithStatus(title: L10n.appName, online: model.online)
			}
			ToolbarItem(placement: .topBarTrailing) {
				Button { router.showPairing = true } label: {
					Image(systemName: "qrcode.viewfinder")
				}
				.accessibilityLabel(L10n.Pair.title)
			}
		}
	}

	private var header: some View {
		VStack(alignment: .leading, spacing: 0) {
			Text(L10n.Home.title)
				.font(.system(size: 34, weight: .bold))
				.foregroundStyle(Theme.ink)
				.padding(.top, 8)
			Text(L10n.Home.subtitle)
				.font(.system(size: 14))
				.foregroundStyle(Theme.dim)
				.padding(.top, 6)

			HStack(alignment: .lastTextBaseline, spacing: 0) {
				Text("\(model.processingCount)")
					.font(.system(size: 30, weight: .bold))
					.foregroundStyle(Theme.green)
					.contentTransition(.numericText())
				Text(L10n.Home.processing).font(.system(size: 13)).foregroundStyle(Theme.dim).padding(.leading, 6)
				Rectangle().fill(Theme.line).frame(width: 1, height: 24).padding(.horizontal, 20).alignmentGuide(.lastTextBaseline) { $0[.bottom] - 4 }
				Text("\(model.sessions.count - model.processingCount)")
					.font(.system(size: 30, weight: .bold))
					.foregroundStyle(Theme.ink)
					.contentTransition(.numericText())
				Text(L10n.Home.done).font(.system(size: 13)).foregroundStyle(Theme.dim).padding(.leading, 6)
			}
			.padding(.top, 20)

			GlassEffectContainer(spacing: 12) {
				HStack(spacing: 12) {
					EntryCard(symbol: "display", title: L10n.Home.remoteDesktop)
					EntryCard(symbol: "apple.terminal", title: L10n.Home.sshTerminal)
				}
			}
			.padding(.top, 20)

			HStack(spacing: 10) {
				Image(systemName: "magnifyingglass").font(.system(size: 15)).foregroundStyle(Theme.dim)
				TextField(L10n.Home.searchPlaceholder, text: $query)
					.font(.system(size: 14))
					.submitLabel(.search)
			}
			.padding(.horizontal, 16)
			.frame(height: 44)
			.glassEffect(.regular.interactive(), in: .capsule)
			.padding(.top, 16)

			Picker("", selection: $filter) {
				Text(L10n.Home.filterAll).tag(Filter.all)
				Text(L10n.Home.filterProcessing(model.processingCount)).tag(Filter.processing)
				Text(L10n.Home.filterDone).tag(Filter.done)
			}
			.pickerStyle(.segmented)
			.padding(.top, 16)

			if !model.online {
				Banner(text: L10n.Home.offlineBanner).padding(.top, 12)
			}
			if let error = model.lastError {
				Button { model.clearError() } label: {
					Text(error).font(.system(size: 12)).foregroundStyle(Theme.red)
				}
				.buttonStyle(.plain)
				.padding(.top, 8)
			}
		}
		.padding(.bottom, 4)
	}
}

/// First-run home: explains what pairing unlocks and opens the scanner.
private struct PairingGuide: View {
	var onScan: () -> Void

	var body: some View {
		VStack(spacing: 0) {
			Spacer(minLength: 24)
			Image(systemName: "qrcode.viewfinder")
				.font(.system(size: 44, weight: .regular))
				.foregroundStyle(Theme.green)
				.frame(width: 96, height: 96)
				.glassEffect(.regular, in: .rect(cornerRadius: 28))
			Text(L10n.Home.unpairedTitle)
				.font(.system(size: 26, weight: .bold))
				.foregroundStyle(Theme.ink)
				.multilineTextAlignment(.center)
				.padding(.top, 28)
			Text(L10n.Home.unpairedDescription)
				.font(.system(size: 14))
				.foregroundStyle(Theme.dim)
				.multilineTextAlignment(.center)
				.lineSpacing(4)
				.padding(.top, 10)
			Spacer(minLength: 24)
			Button(action: onScan) {
				Label(L10n.Home.unpairedScan, systemImage: "qrcode.viewfinder")
					.font(.system(size: 15, weight: .semibold))
					.foregroundStyle(Theme.pillInk)
					.frame(maxWidth: .infinity)
					.padding(.vertical, 8)
			}
			.buttonStyle(.glassProminent)
			.tint(Theme.pill)
			.accessibilityIdentifier("home.pair")
			.padding(.bottom, 16)
		}
		.padding(.horizontal, 24)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(Theme.page)
	}
}

private struct EntryCard: View {
	var symbol: String
	var title: String

	var body: some View {
		HStack(spacing: 12) {
			Image(systemName: symbol)
				.font(.system(size: 17, weight: .medium))
				.foregroundStyle(Theme.green)
				.frame(width: 40, height: 40)
				.background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.card2))
			VStack(alignment: .leading, spacing: 2) {
				Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.ink)
				Text(L10n.Common.comingSoon).font(.system(size: 11)).foregroundStyle(Theme.dim)
			}
			Spacer(minLength: 0)
		}
		.padding(.horizontal, 16)
		.padding(.vertical, 14)
		.frame(maxWidth: .infinity)
		.glassEffect(.regular, in: .rect(cornerRadius: 22))
		.opacity(0.6)
		.accessibilityElement(children: .combine)
	}
}

private struct SessionRow: View {
	var session: RemoteSessionSummary
	var last: Bool
	var onTap: () -> Void

	var body: some View {
		let status = describeStatus(session.status)
		Button(action: onTap) {
			VStack(alignment: .leading, spacing: 0) {
				HStack {
					HStack(spacing: 6) {
						if status.tone == .orange {
							Image(systemName: "exclamationmark.circle").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.orange)
						} else {
							StatusDot(color: status.tone.color, size: 6)
						}
						Text(status.label).font(.system(size: 12)).foregroundStyle(status.tone.color)
					}
					Spacer()
					Text(TimeFormat.relative(session.updatedAt)).font(.system(size: 12)).foregroundStyle(Theme.dim)
				}
				Text(session.title.trimmingCharacters(in: .whitespaces).isEmpty ? L10n.Home.untitled : session.title)
					.font(.system(size: 17, weight: .semibold))
					.foregroundStyle(Theme.ink)
					.lineLimit(2)
					.multilineTextAlignment(.leading)
					.padding(.top, 8)
				if let preview = session.preview, !preview.isEmpty {
					Text(preview)
						.font(.system(size: 14))
						.foregroundStyle(Theme.dim)
						.lineLimit(2)
						.lineSpacing(3)
						.multilineTextAlignment(.leading)
						.padding(.top, 6)
				}
				if status.tone == .green {
					ProgressView(value: 0.75)
						.tint(Theme.green)
						.padding(.top, 12)
				}
			}
			.padding(.vertical, 16)
			.frame(maxWidth: .infinity, alignment: .leading)
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.overlay(alignment: .bottom) {
			if !last { Rectangle().fill(Theme.line).frame(height: 1) }
		}
		.accessibilityIdentifier("session.\(session.id)")
	}
}
