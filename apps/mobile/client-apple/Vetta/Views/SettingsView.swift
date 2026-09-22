import SwiftUI
import VettaKit

struct SettingsView: View {
	@Environment(AppModel.self) private var model
	@Environment(Router.self) private var router
	@State private var confirmUnpair = false

	private var connectionLabel: String {
		let link = model.link
		guard model.online else { return link.status == .connecting ? L10n.Common.connecting : L10n.Settings.offline }
		guard let rtt = link.rttMs, rtt > 0 else { return link.channel == .lan ? L10n.Settings.viaLan : L10n.Settings.viaRelay }
		let ms = Int(rtt.rounded())
		if ms < 60 { return L10n.Settings.excellent(ms) }
		if ms < 200 { return L10n.Settings.good(ms) }
		return L10n.Settings.fair(ms)
	}

	var body: some View {
		let running = Int(model.link.desktop?.runningSessionCount ?? 0)
		List {
			Section {
				VStack(alignment: .leading, spacing: 6) {
					Text(L10n.Settings.heading).font(.system(size: 34, weight: .bold)).foregroundStyle(Theme.ink)
					Text(L10n.Settings.subheading).font(.system(size: 14)).foregroundStyle(Theme.dim)
				}
				.listRowBackground(Color.clear)
				.listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 8, trailing: 4))
			}

			Section {
				HStack {
					VStack(alignment: .leading, spacing: 4) {
						HStack(spacing: 8) {
							Text(L10n.Settings.myComputer).font(.system(size: 17, weight: .semibold))
							StatusDot(color: model.online ? Theme.green : Theme.faint)
						}
						Text(model.desktop.map { "\($0.desktopName) · \(model.online ? L10n.Common.online : L10n.Common.offline)" } ?? L10n.Settings.noComputer)
							.font(.system(size: 13))
							.foregroundStyle(Theme.dim)
					}
					Spacer()
					Button(L10n.Settings.rescan) { router.showPairing = true }
						.buttonStyle(.glass)
						.font(.system(size: 13, weight: .medium))
				}
				HStack(alignment: .top, spacing: 16) {
					VStack(alignment: .leading, spacing: 4) {
						Text(L10n.Settings.connectionState).font(.system(size: 12)).foregroundStyle(Theme.dim)
						Text(connectionLabel)
							.font(.system(size: 15, weight: .semibold))
							.foregroundStyle(model.online ? Theme.green : Theme.ink)
						if model.online, model.link.rttMs != nil {
							Text(model.link.channel == .lan ? L10n.Settings.viaLan : L10n.Settings.viaRelay)
								.font(.system(size: 11))
								.foregroundStyle(Theme.faint)
						}
					}
					.frame(maxWidth: .infinity, alignment: .leading)
					Rectangle().fill(Theme.line).frame(width: 1)
					VStack(alignment: .leading, spacing: 4) {
						Text(L10n.Settings.load).font(.system(size: 12)).foregroundStyle(Theme.dim)
						Text(running > 0 ? L10n.Settings.loadValue(running) : L10n.Settings.loadIdle)
							.font(.system(size: 15, weight: .semibold))
					}
					.frame(maxWidth: .infinity, alignment: .leading)
				}
				.padding(.vertical, 4)
			}

			Section {
				Picker(L10n.Settings.confirmPolicy, selection: Binding(
					get: { model.preferences.confirmPolicy },
					set: { value in model.setPreferences { $0.confirmPolicy = value } }
				)) {
					Text(L10n.Settings.policyMajor).tag(ConfirmPolicy.major)
					Text(L10n.Settings.policyImportant).tag(ConfirmPolicy.important)
					Text(L10n.Settings.policyAuto).tag(ConfirmPolicy.auto)
				}
				.pickerStyle(.segmented)
				.listRowBackground(Color.clear)
				.listRowInsets(EdgeInsets())
			} header: {
				Text(L10n.Settings.confirmPolicy).font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.ink).textCase(nil)
			} footer: {
				Text(L10n.Settings.confirmPolicyHint)
			}

			Section {
				ToggleRow(title: L10n.Settings.liveThinking, hint: L10n.Settings.liveThinkingHint, value: Binding(
					get: { model.preferences.liveThinking },
					set: { value in model.setPreferences { $0.liveThinking = value } }
				))
				ToggleRow(title: L10n.Settings.haptics, hint: L10n.Settings.hapticsHint, value: Binding(
					get: { model.preferences.haptics },
					set: { value in model.setPreferences { $0.haptics = value } }
				))
				ToggleRow(title: L10n.Settings.biometric, hint: L10n.Settings.biometricHint, value: .constant(false), comingSoon: true)
			}

			Section {
				Button(role: .destructive) { confirmUnpair = true } label: {
					VStack(alignment: .leading, spacing: 4) {
						Text(L10n.Settings.unpair).font(.system(size: 15, weight: .semibold))
						Text(L10n.Settings.unpairHint).font(.system(size: 12)).foregroundStyle(Theme.dim)
					}
				}
				.accessibilityIdentifier("settings.unpair")
			}
		}
		.scrollContentBackground(.hidden)
		.background(Theme.page)
		.navigationTitle(L10n.Settings.title)
		.navigationBarTitleDisplayMode(.inline)
		.alert(L10n.Settings.unpair, isPresented: $confirmUnpair) {
			Button(L10n.Common.cancel, role: .cancel) {}
			Button(L10n.Settings.unpair, role: .destructive) { model.unpair() }
		} message: {
			Text(L10n.Settings.unpairConfirm)
		}
	}
}

private struct ToggleRow: View {
	var title: String
	var hint: String
	@Binding var value: Bool
	var comingSoon = false

	var body: some View {
		Toggle(isOn: $value) {
			VStack(alignment: .leading, spacing: 4) {
				HStack(spacing: 8) {
					Text(title).font(.system(size: 15, weight: .semibold))
					if comingSoon {
						Text(L10n.Common.comingSoon)
							.font(.system(size: 10))
							.foregroundStyle(Theme.dim)
							.padding(.horizontal, 8)
							.padding(.vertical, 2)
							.background(Capsule().fill(Theme.card2))
					}
				}
				Text(hint).font(.system(size: 12)).foregroundStyle(Theme.dim)
			}
		}
		.tint(Theme.green)
		.disabled(comingSoon)
		.opacity(comingSoon ? 0.5 : 1)
		.padding(.vertical, 4)
	}
}
