import SwiftUI
import VettaKit
import VettaRTC

/// The paired computer's screen, full size on black, with the whole phone screen as its
/// trackpad and the phone's keyboard as its keyboard (ADR-0140). The computer captures only while this page is open and the app is in
/// front. When the picture cannot show, the page says why and what to do instead of
/// staying black. The only page that turns to landscape; controls move to the sides
/// there so the picture keeps the full height.
struct RemoteDesktopScreen: View {
	@Environment(AppModel.self) private var model
	@Environment(\.dismiss) private var dismiss
	@State private var keyboardOpen = false
	@State private var landscape = false
	/// Waited this long for the direct connection without it coming up.
	@State private var gaveUpWaiting = false

	private var sessions: RemoteDesktopSessions { .shared }

	var body: some View {
		GeometryReader { proxy in
			let wide = proxy.size.width > proxy.size.height
			let safe = proxy.safeAreaInsets
			ZStack {
				Color.black.ignoresSafeArea()
				// The whole screen is the trackpad; the picture keeps clear of the controls.
				screen(insets: wide
					? UIEdgeInsets(top: safe.top, left: safe.leading + 64, bottom: safe.bottom, right: safe.trailing + 64)
					: UIEdgeInsets(top: safe.top + 60, left: safe.leading, bottom: safe.bottom + 60, right: safe.trailing))
					.ignoresSafeArea()
				if wide {
					HStack(spacing: 0) {
						VStack {
							close
							Spacer()
							keyboardButton
						}
						.padding(8)
						VStack(spacing: 6) {
							if let summary = statsLine {
								Text(summary)
									.font(.caption2.monospacedDigit())
									.foregroundStyle(.white.opacity(0.8))
									.padding(.horizontal, 10)
									.padding(.vertical, 4)
									.background(.black.opacity(0.45), in: .capsule)
									.padding(.top, 6)
									.allowsHitTesting(false)
							}
							viewOnlyBanner
							Spacer()
						}
						VStack {
							Spacer()
							rotate
						}
						.padding(8)
					}
				} else {
					VStack(spacing: 0) {
						HStack(spacing: 12) {
							close
							title
							Spacer(minLength: 0)
						}
						.padding(.horizontal, 12)
						.padding(.vertical, 8)
						viewOnlyBanner
						Spacer()
						HStack(spacing: 12) {
							keyboardButton
							Text(L10n.Remote.hint)
								.font(.caption)
								.foregroundStyle(.white.opacity(0.5))
								.multilineTextAlignment(.center)
								.frame(maxWidth: .infinity)
								.allowsHitTesting(false)
							rotate
						}
						.padding(.horizontal, 12)
						.padding(.vertical, 8)
					}
				}
				if let session = liveSession, interactive {
					RemoteKeyboard(open: $keyboardOpen) { session.send($0) }
						.frame(width: 1, height: 1)
						.allowsHitTesting(false)
				}
			}
		}
		.preferredColorScheme(.dark)
		.statusBarHidden(true)
		.persistentSystemOverlays(.hidden)
		// A swipe from the edge would otherwise leave the page mid-drag.
		.defersSystemGestures(on: .all)
		.onAppear {
			model.setScreenOpen(true)
			OrientationLock.allow(.allButUpsideDown, turn: .portrait)
			// The screen stays on while the desktop is being watched.
			UIApplication.shared.isIdleTimerDisabled = true
		}
		.onDisappear {
			model.setScreenOpen(false)
			OrientationLock.allow(.portrait)
			UIApplication.shared.isIdleTimerDisabled = false
		}
		.task(id: waitingForDirect) {
			gaveUpWaiting = false
			guard waitingForDirect else { return }
			// The link tries P2P for 12 s at a time; past two tries it is not coming.
			try? await Task.sleep(for: .seconds(26))
			if !Task.isCancelled { gaveUpWaiting = true }
		}
		.onChange(of: model.paired) { _, paired in
			if !paired { dismiss() }
		}
	}

	// MARK: Picture

	@ViewBuilder
	private func screen(insets: UIEdgeInsets) -> some View {
		if let session = liveSession, blocker == nil {
			RemoteScreenView(track: session.videoTrack, interactive: interactive, insets: insets, cursor: model.screenCursor) { session.send($0) }
				.accessibilityIdentifier("remote.screen")
		} else {
			VStack(spacing: 14) {
				if blocker == nil || blocker == L10n.Remote.connecting {
					ProgressView().tint(.white)
				} else {
					Image(systemName: "display")
						.font(.system(size: 44))
						.foregroundStyle(.white.opacity(0.5))
				}
				Text(blocker ?? L10n.Remote.connecting)
					.foregroundStyle(.white.opacity(0.75))
					.multilineTextAlignment(.center)
					.accessibilityIdentifier("remote.unavailable")
				// What the direct connection got through so far, to tell where it stops.
				if waitingForDirect, let trace = target.flatMap({ sessions.latest(for: $0)?.trace }), !trace.isEmpty {
					VStack(alignment: .leading, spacing: 2) {
						Text(L10n.Remote.details)
							.font(.caption2.weight(.semibold))
						ForEach(Array(trace.enumerated()), id: \.offset) { _, step in
							Text(step)
						}
					}
					.font(.caption2.monospaced())
					.foregroundStyle(.white.opacity(0.5))
					.frame(maxWidth: .infinity, alignment: .leading)
					.padding(.top, 8)
					.accessibilityIdentifier("remote.trace")
				}
			}
			.padding(32)
			.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
	}

	/// Taps cannot reach the desktop: said along the top of the picture.
	@ViewBuilder
	private var viewOnlyBanner: some View {
		if liveSession != nil, blocker == nil, let viewOnly {
			Text(viewOnly)
				.font(.footnote)
				.foregroundStyle(.white)
				.multilineTextAlignment(.center)
				.padding(.horizontal, 16)
				.padding(.vertical, 8)
				.frame(maxWidth: .infinity)
				.background(.black.opacity(0.6))
				.allowsHitTesting(false)
				.accessibilityIdentifier("remote.viewOnly")
		}
	}

	private var target: String? { model.remoteDesktopTarget }

	/// Route, latency and frame rate of the picture, so a slow network and a slow picture
	/// can be told apart.
	private var statsLine: String? {
		guard let summary = liveSession?.stats?.summary, !summary.isEmpty else { return nil }
		return summary
	}

	/// The WebRTC session the link opened, while it lasts.
	private var liveSession: RemoteDesktopSession? {
		target.flatMap { sessions.session(for: $0) }.flatMap { $0.phase == .connected ? $0 : nil }
	}

	/// Why there is no picture, most fundamental first; nil when it should show.
	private var blocker: String? {
		let desktop = model.link.desktop
		if desktop?.desktopControl == false { return L10n.Remote.notAllowed }
		if !model.online || desktop == nil { return L10n.Remote.offline }
		if target == nil { return L10n.Remote.noRelay }
		if desktop?.screen != true { return L10n.Remote.updateDesktop }
		if liveSession == nil { return gaveUpWaiting ? L10n.Remote.noDirectRoute : L10n.Remote.connecting }
		switch model.screen?.screen {
		case .permissionDenied: return L10n.Remote.screenPermission
		case .unavailable: return L10n.Remote.unavailable
		default: return nil
		}
	}

	/// The direct connection is what is missing: worth waiting for, up to a point.
	private var waitingForDirect: Bool {
		model.online && model.link.desktop?.screen == true && target != nil && liveSession == nil
	}

	private var viewOnly: String? {
		switch model.screen?.input {
		case .permissionDenied: L10n.Remote.inputPermission
		case .unsupported: L10n.Remote.inputUnsupported
		default: nil
		}
	}

	private var interactive: Bool { blocker == nil && viewOnly == nil }

	// MARK: Controls

	private var close: some View {
		ScreenButton(symbol: "xmark", label: L10n.Common.close, identifier: "remote.close") {
			keyboardOpen = false
			dismiss()
		}
	}

	private var keyboardButton: some View {
		ScreenButton(symbol: keyboardOpen ? "keyboard.chevron.compact.down" : "keyboard", label: keyboardOpen ? L10n.Remote.hideKeyboard : L10n.Remote.keyboard, identifier: "remote.keyboard") {
			keyboardOpen.toggle()
		}
		.disabled(!interactive)
		.opacity(interactive ? 1 : 0.4)
	}

	private var rotate: some View {
		ScreenButton(symbol: "rotate.right", label: L10n.Remote.rotate, identifier: "remote.rotate") {
			landscape.toggle()
			OrientationLock.allow(.allButUpsideDown, turn: landscape ? .landscapeRight : .portrait)
		}
	}

	/// The computer's name, and how the phone reaches it.
	private var title: some View {
		VStack(alignment: .leading, spacing: 2) {
			Text(model.desktop?.desktopName ?? L10n.Remote.title)
				.font(.headline)
				.foregroundStyle(.white)
				.lineLimit(1)
				.accessibilityAddTraits(.isHeader)
			Text(statsLine ?? (model.online ? (model.link.channel?.label ?? L10n.Common.online) : L10n.Common.offline))
				.font(.caption.monospacedDigit())
				.foregroundStyle(.white.opacity(0.6))
				.lineLimit(1)
		}
	}
}

/// A round glass button on the black page.
private struct ScreenButton: View {
	var symbol: String
	var label: String
	var identifier: String
	var action: () -> Void

	var body: some View {
		Button(action: action) {
			Image(systemName: symbol)
				.font(.title3.weight(.medium))
				.foregroundStyle(.white)
				.frame(width: 44, height: 44)
				.contentShape(.circle)
		}
		.buttonStyle(.plain)
		.glassEffect(.regular.interactive(), in: .circle)
		.accessibilityLabel(label)
		.accessibilityIdentifier(identifier)
	}
}
