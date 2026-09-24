import SwiftUI
import VettaKit

struct SettingsView: View {
	@Environment(AppModel.self) private var model
	@Environment(Router.self) private var router
	@State private var confirmUnpair = false

	var body: some View {
		List {
			computerSection

			Section {
				Picker(L10n.Settings.confirmPolicy, selection: Binding(
					get: { model.preferences.confirmPolicy },
					set: { value in model.setPreferences { $0.confirmPolicy = value } }
				)) {
					Text(L10n.Settings.policyMajor).tag(ConfirmPolicy.major)
					Text(L10n.Settings.policyImportant).tag(ConfirmPolicy.important)
					Text(L10n.Settings.policyAuto).tag(ConfirmPolicy.auto)
				}
				.pickerStyle(.menu)
				.accessibilityIdentifier("settings.confirmPolicy")
			} footer: {
				Text(L10n.Settings.confirmPolicyHint)
			}

			Section {
				Toggle(L10n.Settings.liveThinking, isOn: Binding(
					get: { model.preferences.liveThinking },
					set: { value in model.setPreferences { $0.liveThinking = value } }
				))
				Toggle(L10n.Settings.haptics, isOn: Binding(
					get: { model.preferences.haptics },
					set: { value in model.setPreferences { $0.haptics = value } }
				))
			}
			.tint(Theme.switchOn)

			if model.paired {
				Section {
					Button(L10n.Settings.unpair, role: .destructive) { confirmUnpair = true }
						.frame(maxWidth: .infinity)
						.accessibilityIdentifier("settings.unpair")
				} footer: {
					Text(L10n.Settings.unpairHint)
				}
			}
		}
		.navigationTitle(L10n.Settings.title)
		.navigationBarTitleDisplayMode(.large)
		.alert(L10n.Settings.unpair, isPresented: $confirmUnpair) {
			Button(L10n.Common.cancel, role: .cancel) {}
			Button(L10n.Settings.unpair, role: .destructive) { model.unpair() }
		} message: {
			Text(L10n.Settings.unpairConfirm)
		}
	}

	@ViewBuilder
	private var computerSection: some View {
		Section {
			if let desktop = model.desktop {
				HStack(spacing: 14) {
					Image(systemName: "laptopcomputer")
						.font(.system(size: 26, weight: .medium))
						.foregroundStyle(Theme.pillInk)
						.frame(width: 56, height: 56)
						.background(Theme.pill.gradient, in: .rect(cornerRadius: 14))
					VStack(alignment: .leading, spacing: 2) {
						Text(desktop.desktopName)
							.font(.title3.weight(.semibold))
							.lineLimit(1)
						Text(linkLine)
							.font(.subheadline)
							.foregroundStyle(.secondary)
					}
				}
				.padding(.vertical, 4)
				.accessibilityElement(children: .combine)
				.accessibilityIdentifier("settings.computer")
				if model.online {
					LabeledContent(L10n.Settings.latency, value: latency)
					LabeledContent(L10n.Settings.load, value: load)
				}
				Button(L10n.Settings.rescan) { router.showPairing = true }
					.foregroundStyle(Theme.ink)
					.accessibilityIdentifier("settings.rescan")
			} else {
				Button { router.showPairing = true } label: {
					Label(L10n.Settings.scanToConnect, systemImage: "qrcode.viewfinder")
				}
				.foregroundStyle(Theme.ink)
				.accessibilityIdentifier("settings.scan")
			}
		}
	}

	private var linkLine: String {
		switch LinkIndicator(model.link) {
		case .online:
			guard let channel = model.link.channel else { return L10n.Common.online }
			return "\(L10n.Common.online) · \(channel == .lan ? L10n.Settings.viaLan : L10n.Settings.viaRelay)"
		case .connecting: return L10n.Link.connecting
		case let .reconnecting(attempt): return L10n.Link.reconnecting(attempt)
		case .offline: return L10n.Common.offline
		}
	}

	private var latency: String {
		guard let rtt = model.link.rttMs, rtt > 0 else { return "—" }
		return L10n.Link.latency(Int(rtt.rounded()))
	}

	private var load: String {
		let running = Int(model.link.desktop?.runningSessionCount ?? 0)
		return running > 0 ? L10n.Settings.loadValue(running) : L10n.Settings.loadIdle
	}
}
