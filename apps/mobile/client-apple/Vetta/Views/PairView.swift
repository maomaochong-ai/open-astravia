import SwiftUI
import VettaKit

struct PairView: View {
	@Environment(AppModel.self) private var model
	@Environment(Router.self) private var router
	@Environment(\.dismiss) private var dismiss
	@State private var camera = CameraAccess.current
	@State private var manualOpen = false
	@State private var helpOpen = false
	@State private var busy = false

	private var scanning: Bool { model.pairing == .idle && !manualOpen && !helpOpen }

	var body: some View {
		NavigationStack {
			VStack(spacing: 0) {
				ScanFrame(active: scanning && camera == .granted) {
					cameraContent
				}
				.padding(.top, 32)

				if case let .awaitingApproval(code, _) = model.pairing, !manualOpen {
					VerificationCodeView(code: code).padding(.top, 32)
				} else {
					Text(L10n.Pair.scanHint)
						.font(.system(size: 20, weight: .semibold))
						.foregroundStyle(Theme.ink)
						.padding(.top, 32)
					Text(L10n.Pair.scanDescription)
						.font(.system(size: 13))
						.foregroundStyle(Theme.dim)
						.multilineTextAlignment(.center)
						.lineSpacing(4)
						.padding(.horizontal, 16)
						.padding(.top, 8)
				}

				HStack(spacing: 8) {
					if model.pairing.isConnecting {
						ProgressView().controlSize(.small).tint(Theme.green)
					} else {
						StatusDot(color: Theme.green, size: 6)
					}
					Text(model.pairing.isConnecting ? L10n.Pair.connecting : L10n.Pair.listening)
						.font(.system(size: 12))
						.foregroundStyle(Theme.ink2)
				}
				.padding(.horizontal, 14)
				.padding(.vertical, 9)
				.glassEffect(.regular, in: .capsule)
				.padding(.top, 20)

				if case let .failed(reason) = model.pairing, !manualOpen {
					Text(L10n.Pair.describe(reason))
						.font(.system(size: 13))
						.foregroundStyle(Theme.red)
						.multilineTextAlignment(.center)
						.padding(.top, 16)
						.accessibilityIdentifier("pair.error")
				}
				Spacer(minLength: 16)

				Button { manualOpen = true } label: {
					Label(L10n.Pair.manual, systemImage: "keyboard")
						.font(.system(size: 15, weight: .semibold))
						.foregroundStyle(Theme.pillInk)
						.frame(maxWidth: .infinity)
						.padding(.vertical, 8)
				}
				.buttonStyle(.glassProminent)
				.tint(Theme.pill)
				.accessibilityIdentifier("pair.manual")

				Button { helpOpen = true } label: {
					HStack(spacing: 4) {
						Text(L10n.Pair.troubleshoot)
						Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
					}
					.font(.system(size: 13))
					.foregroundStyle(Theme.dim)
				}
				.buttonStyle(.plain)
				.padding(.top, 16)
				.padding(.bottom, 8)
			}
			.padding(.horizontal, 24)
			.frame(maxWidth: .infinity)
			.background(Theme.page)
			.navigationTitle(L10n.Pair.title)
			.navigationBarTitleDisplayMode(.inline)
			.toolbar {
				if model.paired {
					ToolbarItem(placement: .topBarLeading) {
						Button {
							model.cancelPairing()
							dismiss()
						} label: {
							Image(systemName: "xmark")
						}
						.accessibilityLabel(L10n.Common.close)
					}
				}
				ToolbarItem(placement: .topBarTrailing) {
					Button { helpOpen = true } label: {
						Image(systemName: "wifi.exclamationmark").foregroundStyle(Theme.dim)
					}
					.accessibilityLabel(L10n.Pair.troubleshootTitle)
				}
			}
			.sheet(isPresented: $manualOpen, onDismiss: { model.cancelPairing() }) {
				ManualPairSheet { endpoint in
					await submit { await model.pairManually(endpoint) }
				}
				.presentationDetents([.height(360)])
			}
			.sheet(isPresented: $helpOpen) {
				TroubleshootSheet().presentationDetents([.medium, .large])
			}
			.task {
				if camera == .unknown { camera = await CameraAccess.request() }
			}
		}
		.tint(Theme.ink)
		.interactiveDismissDisabled(!model.paired)
	}

	@ViewBuilder
	private var cameraContent: some View {
		switch camera {
		case .granted:
			QRScannerView(active: scanning) { code in
				Task { await submit { await model.pairWithCode(code) } }
			}
		case .denied:
			VStack(spacing: 12) {
				Text(L10n.Pair.cameraDenied).font(.system(size: 13)).foregroundStyle(Theme.dim)
				Button(L10n.Pair.grantCamera) {
					if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
				}
				.buttonStyle(.glass)
			}
			.padding(24)
		case .unavailable:
			Text(L10n.Pair.cameraUnavailable)
				.font(.system(size: 13))
				.foregroundStyle(Theme.dim)
				.multilineTextAlignment(.center)
				.padding(24)
		case .unknown:
			ProgressView()
		}
	}

	/// One pairing at a time; on success close the screen and reconnect.
	private func submit(_ attempt: () async -> Bool) async {
		guard !busy else { return }
		busy = true
		let ok = await attempt()
		busy = false
		guard ok else { return }
		manualOpen = false
		model.refreshLink()
		router.showPairing = false
	}
}

private struct VerificationCodeView: View {
	var code: String

	var body: some View {
		VStack(spacing: 0) {
			Text(L10n.Pair.verificationCode).font(.system(size: 13)).foregroundStyle(Theme.dim)
			Text(code)
				.font(.mono(40, weight: .bold))
				.tracking(8)
				.foregroundStyle(Theme.ink)
				.padding(.top, 8)
				.accessibilityIdentifier("pair.code")
			Text(L10n.Pair.waitingApproval).font(.system(size: 14)).foregroundStyle(Theme.ink2).padding(.top, 12)
			Text(L10n.Pair.codeHint).font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 4)
		}
		.multilineTextAlignment(.center)
	}
}

private struct ManualPairSheet: View {
	@Environment(AppModel.self) private var model
	var onSubmit: (String) async -> Void
	@State private var endpoint = ""
	@FocusState private var focused: Bool

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			Text(L10n.Pair.manualTitle).font(.system(size: 18, weight: .semibold)).foregroundStyle(Theme.ink)
			Text(L10n.Pair.manualHint).font(.system(size: 13)).foregroundStyle(Theme.dim).padding(.top, 4)
			if case let .awaitingApproval(code, _) = model.pairing {
				VerificationCodeView(code: code).frame(maxWidth: .infinity).padding(.top, 20)
			} else {
				TextField(L10n.Pair.manualPlaceholder, text: $endpoint)
					.font(.mono(16))
					.textInputAutocapitalization(.never)
					.autocorrectionDisabled()
					.keyboardType(.URL)
					.submitLabel(.go)
					.focused($focused)
					.onSubmit(submit)
					.padding(.horizontal, 16)
					.frame(height: 52)
					.glassEffect(.regular.interactive(), in: .rect(cornerRadius: 16))
					.padding(.top, 16)
					.accessibilityIdentifier("pair.endpoint")
				if case let .failed(reason) = model.pairing {
					Text(L10n.Pair.describe(reason)).font(.system(size: 12)).foregroundStyle(Theme.red).padding(.top, 8)
				}
				Button(action: submit) {
					Group {
						if model.pairing.isConnecting {
							ProgressView().tint(Theme.dim)
						} else {
							Text(L10n.Pair.connect).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.pillInk)
						}
					}
					.frame(maxWidth: .infinity)
					.padding(.vertical, 6)
				}
				.buttonStyle(.glassProminent)
				.tint(Theme.pill)
				.disabled(model.pairing.isConnecting)
				.padding(.top, 16)
				.accessibilityIdentifier("pair.connect")
			}
			Spacer(minLength: 0)
		}
		.padding(.horizontal, 20)
		.padding(.top, 24)
		.onAppear { focused = true }
	}

	private func submit() {
		let value = endpoint
		Task { await onSubmit(value) }
	}
}

private struct TroubleshootSheet: View {
	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 12) {
				Text(L10n.Pair.troubleshootTitle).font(.system(size: 18, weight: .semibold)).foregroundStyle(Theme.ink)
				ForEach(Array(L10n.Pair.troubleshootItems.enumerated()), id: \.offset) { index, item in
					HStack(alignment: .firstTextBaseline, spacing: 12) {
						Text("\(index + 1)").font(.mono(13)).foregroundStyle(Theme.green)
						Text(item).font(.system(size: 14)).lineSpacing(5).foregroundStyle(Theme.ink2)
					}
				}
			}
			.padding(.horizontal, 20)
			.padding(.top, 24)
		}
	}
}

/// Viewfinder with green corner brackets and a sweeping scan line.
struct ScanFrame<Content: View>: View {
	var active: Bool
	@ViewBuilder var content: Content
	private let size: CGFloat = 260

	var body: some View {
		ZStack {
			content.frame(width: size, height: size)
			Corners().stroke(Theme.green, style: StrokeStyle(lineWidth: 3, lineCap: .round)).padding(10)
			if active {
				TimelineView(.animation) { context in
					let period = 3.6
					let phase = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period) / period
					let eased = 0.5 - 0.5 * cos(phase * 2 * .pi)
					Capsule()
						.fill(Theme.green.opacity(0.85))
						.frame(height: 2)
						.shadow(color: Theme.green.opacity(0.8), radius: 8)
						.padding(.horizontal, 24)
						.offset(y: -size / 2 + 20 + (size - 40) * eased)
				}
				.allowsHitTesting(false)
			}
		}
		.frame(width: size, height: size)
		.background(Theme.card)
		.clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
		.glassEffect(.regular, in: .rect(cornerRadius: 28))
	}
}

private nonisolated struct Corners: Shape {
	func path(in rect: CGRect) -> Path {
		let length: CGFloat = 34
		let radius: CGFloat = 14
		var path = Path()
		// top-left
		path.move(to: CGPoint(x: rect.minX, y: rect.minY + length))
		path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + radius))
		path.addQuadCurve(to: CGPoint(x: rect.minX + radius, y: rect.minY), control: CGPoint(x: rect.minX, y: rect.minY))
		path.addLine(to: CGPoint(x: rect.minX + length, y: rect.minY))
		// top-right
		path.move(to: CGPoint(x: rect.maxX - length, y: rect.minY))
		path.addLine(to: CGPoint(x: rect.maxX - radius, y: rect.minY))
		path.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY + radius), control: CGPoint(x: rect.maxX, y: rect.minY))
		path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + length))
		// bottom-right
		path.move(to: CGPoint(x: rect.maxX, y: rect.maxY - length))
		path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - radius))
		path.addQuadCurve(to: CGPoint(x: rect.maxX - radius, y: rect.maxY), control: CGPoint(x: rect.maxX, y: rect.maxY))
		path.addLine(to: CGPoint(x: rect.maxX - length, y: rect.maxY))
		// bottom-left
		path.move(to: CGPoint(x: rect.minX + length, y: rect.maxY))
		path.addLine(to: CGPoint(x: rect.minX + radius, y: rect.maxY))
		path.addQuadCurve(to: CGPoint(x: rect.minX, y: rect.maxY - radius), control: CGPoint(x: rect.minX, y: rect.maxY))
		path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY - length))
		return path
	}
}
