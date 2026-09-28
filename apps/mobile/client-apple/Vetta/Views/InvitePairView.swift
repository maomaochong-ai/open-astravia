import SwiftUI
import UIKit
import VettaKit

/// Pairing with the connection code and password the computer shows next to its QR code
/// (ADR-0136), one step at a time: eight boxes for the code, then six for the password.
/// A full code moves on by itself and a full password connects; what went wrong sends
/// the user back to the step that needs fixing. The picture on top follows along, the
/// way Telegram's login does: it answers what is typed rather than playing on its own.
struct InvitePairView: View {
	@Environment(AppModel.self) private var model
	/// Pairs with what was typed; true once paired.
	var connect: (_ code: String, _ password: String, _ relay: String?) async -> Bool
	/// Called a moment after pairing, once the lock has been seen to open.
	var onPaired: () -> Void

	private enum Step { case code, password }
	private enum Field { case code, password, relay }

	@State private var step = Step.code
	@State private var code = ""
	@State private var password = ""
	@State private var ownRelay = false
	@State private var relay = ""
	@State private var error: String?
	@State private var shakes = 0
	@State private var paired = false
	@FocusState private var focus: Field?

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			InviteHero(stage: heroStage, failures: shakes)
				.frame(maxWidth: .infinity)
				.padding(.bottom, 20)
			if case let .awaitingApproval(verification, _) = model.pairing {
				VerificationCodeView(code: verification).frame(maxWidth: .infinity)
			} else {
				switch step {
				case .code:
					codeStep.transition(.asymmetric(insertion: .move(edge: .leading), removal: .move(edge: .leading)).combined(with: .opacity))
				case .password:
					passwordStep.transition(.asymmetric(insertion: .move(edge: .trailing), removal: .move(edge: .trailing)).combined(with: .opacity))
				}
			}
			Spacer(minLength: 0)
		}
		.padding(.horizontal, 24)
		.padding(.top, 36)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.overlay(alignment: .topLeading) {
			if step == .password, !paired {
				Button(action: back) {
					Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.ink)
						.frame(width: 44, height: 44)
				}
				.buttonStyle(.plain)
				.accessibilityLabel(L10n.Common.back)
				.padding(.leading, 12)
				.padding(.top, 8)
			}
		}
		.background(Theme.page)
		.sensoryFeedback(.error, trigger: shakes)
		.onAppear { focus = .code }
		.onChange(of: code) { _, typed in
			let clean = InviteCode.typedCode(typed)
			if clean != typed { code = clean }
			if !clean.isEmpty { error = nil }
			if clean.count == InviteCode.codeLength, step == .code { advance() }
		}
		.onChange(of: password) { _, typed in
			let clean = InviteCode.typedPassword(typed)
			if clean != typed { password = clean }
			if !clean.isEmpty { error = nil }
			if clean.count == InviteCode.passwordLength { submit() }
		}
	}

	// MARK: Steps

	private var codeStep: some View {
		VStack(alignment: .leading, spacing: 0) {
			heading(L10n.Pair.inviteCodeTitle, L10n.Pair.inviteCodeHint)
			boxes(for: .code)
			errorLine
			relayOption
			Button(action: advance) {
				Text(L10n.Pair.inviteNext)
					.font(.system(size: 15, weight: .semibold))
					.foregroundStyle(Theme.pillInk)
					.frame(maxWidth: .infinity)
					.padding(.vertical, 6)
			}
			.buttonStyle(.glassProminent)
			.tint(Theme.pill)
			.disabled(code.count < InviteCode.codeLength)
			.padding(.top, 24)
			.accessibilityIdentifier("pair.invite.next")
		}
	}

	private var passwordStep: some View {
		VStack(alignment: .leading, spacing: 0) {
			heading(L10n.Pair.invitePasswordTitle, L10n.Pair.invitePasswordHint)
			HStack(spacing: 8) {
				Text(formatted(code)).font(.mono(14, weight: .semibold)).foregroundStyle(Theme.ink2)
				Button(L10n.Pair.inviteEditCode, action: back)
					.font(.system(size: 13, weight: .medium))
					.foregroundStyle(Theme.blue)
					.buttonStyle(.plain)
					.accessibilityIdentifier("pair.invite.editCode")
			}
			.frame(maxWidth: .infinity)
			.padding(.top, -12)
			.padding(.bottom, 20)
			boxes(for: .password)
			errorLine
			Button(action: submit) {
				Group {
					if model.pairing.isConnecting {
						ProgressView().tint(Theme.pillInk)
					} else {
						Text(L10n.Pair.connect).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.pillInk)
					}
				}
				.frame(maxWidth: .infinity)
				.padding(.vertical, 6)
			}
			.buttonStyle(.glassProminent)
			.tint(Theme.pill)
			.disabled(model.pairing.isConnecting || password.count < InviteCode.passwordLength)
			.padding(.top, 24)
			.accessibilityIdentifier("pair.invite.connect")
		}
	}

	private func heading(_ title: String, _ hint: String) -> some View {
		VStack(spacing: 8) {
			Text(title).font(.system(size: 26, weight: .bold)).foregroundStyle(Theme.ink)
			Text(hint).font(.system(size: 14)).foregroundStyle(Theme.dim).lineSpacing(3).fixedSize(horizontal: false, vertical: true)
		}
		.multilineTextAlignment(.center)
		.frame(maxWidth: .infinity)
		.padding(.bottom, 28)
	}

	/// The boxes over a field nobody sees: the keyboard types into the field, the boxes
	/// show what it holds, and a tap anywhere on them brings the keyboard back.
	private func boxes(for field: Field) -> some View {
		let isCode = field == .code
		return ZStack {
			TextField("", text: isCode ? $code : $password)
				.keyboardType(isCode ? .asciiCapable : .numberPad)
				.textInputAutocapitalization(isCode ? .characters : .never)
				.autocorrectionDisabled()
				.focused($focus, equals: field)
				.frame(width: 1, height: 1)
				.opacity(0.01)
				.accessibilityLabel(isCode ? L10n.Pair.inviteCode : L10n.Pair.invitePassword)
				.accessibilityIdentifier(isCode ? "pair.invite.code" : "pair.invite.password")
			CodeBoxes(
				value: isCode ? code : password,
				length: isCode ? InviteCode.codeLength : InviteCode.passwordLength,
				split: isCode ? InviteCode.codeLength / 2 : nil,
				active: focus == field,
				failed: error != nil
			)
			.modifier(Shake(animatableData: CGFloat(shakes)))
			.animation(.linear(duration: 0.4), value: shakes)
			.accessibilityHidden(true)
		}
		.contentShape(Rectangle())
		.onTapGesture { focus = field }
		.contextMenu {
			Button(L10n.Pair.invitePaste, systemImage: "doc.on.clipboard") {
				guard let pasted = UIPasteboard.general.string else { return }
				if isCode { code = pasted } else { password = pasted }
			}
		}
	}

	@ViewBuilder
	private var errorLine: some View {
		if let error {
			Text(error)
				.font(.system(size: 13))
				.foregroundStyle(Theme.red)
				.multilineTextAlignment(.center)
				.fixedSize(horizontal: false, vertical: true)
				.frame(maxWidth: .infinity)
				.padding(.top, 12)
				.accessibilityIdentifier("pair.invite.error")
		}
	}

	private var relayOption: some View {
		VStack(alignment: .leading, spacing: 10) {
			Button {
				withAnimation(.snappy) { ownRelay.toggle() }
				if ownRelay { focus = .relay }
			} label: {
				HStack(spacing: 4) {
					Text(L10n.Pair.inviteOwnRelay)
					Image(systemName: ownRelay ? "chevron.up" : "chevron.down").font(.system(size: 11, weight: .semibold))
				}
				.font(.system(size: 13))
				.foregroundStyle(Theme.dim)
			}
			.buttonStyle(.plain)
			.frame(maxWidth: .infinity)
			.accessibilityIdentifier("pair.invite.ownRelay")
			if ownRelay {
				TextField(InviteCode.defaultRelayBaseUrl, text: $relay)
					.font(.mono(15))
					.textInputAutocapitalization(.never)
					.autocorrectionDisabled()
					.keyboardType(.URL)
					.focused($focus, equals: .relay)
					.padding(.horizontal, 16)
					.frame(height: 48)
					.glassEffect(.regular.interactive(), in: .rect(cornerRadius: 14))
					.accessibilityLabel(L10n.Pair.inviteRelay)
					.accessibilityIdentifier("pair.invite.relay")
			}
		}
		.padding(.top, 20)
	}

	// MARK: Actions

	private func advance() {
		guard code.count == InviteCode.codeLength else { return }
		error = nil
		withAnimation(.snappy) { step = .password }
		focus = .password
	}

	private func back() {
		error = nil
		password = ""
		withAnimation(.snappy) { step = .code }
		focus = .code
	}

	private func submit() {
		guard !model.pairing.isConnecting, InviteCode.isValidPassword(password),
		      let normalized = InviteCode.normalize(code) else { return }
		let typed = password
		let typedRelay = ownRelay ? relay : nil
		Task {
			if await connect(normalized, typed, typedRelay) {
				focus = nil
				paired = true
				try? await Task.sleep(for: .milliseconds(800))
				onPaired()
				return
			}
			guard case let .failed(reason) = model.pairing else { return }
			failed(reason)
		}
	}

	/// Says what went wrong where it can be fixed: an unknown code on the code step, a
	/// wrong password cleared for another try, anything else left as it was to retry.
	private func failed(_ reason: PairingFailure) {
		password = reason == .inviteWrongPassword || reason == .inviteNotFound ? "" : password
		error = L10n.Pair.describe(reason)
		shakes += 1
		if reason == .inviteNotFound {
			withAnimation(.snappy) { step = .code }
			focus = .code
		} else {
			focus = .password
		}
	}

	private var heroStage: InviteHero.Stage {
		if paired { return .paired }
		if model.pairing.isConnecting { return .connecting }
		if case .awaitingApproval = model.pairing { return .connecting }
		return step == .code ? .code(filled: code.count) : .password(filled: password.count)
	}

	private func formatted(_ code: String) -> String {
		code.count > 4 ? "\(code.prefix(4))-\(code.dropFirst(4))" : code
	}
}

/// The picture over the steps, drawn from SF Symbols so it needs no artwork: the computer
/// and this phone join up dot by dot as the code is typed, then a lock takes a knock
/// per digit, breathes while connecting, shakes when turned down and opens once paired.
private struct InviteHero: View {
	enum Stage: Equatable {
		case code(filled: Int)
		case password(filled: Int)
		case connecting
		case paired
	}

	var stage: Stage
	var failures: Int

	var body: some View {
		ZStack {
			if case let .code(filled) = stage {
				link(filled).transition(.blurReplace)
			} else {
				lock.transition(.blurReplace)
			}
		}
		.frame(height: 72)
		.animation(.snappy, value: stage)
		.symbolEffect(.wiggle, options: .speed(1.4), value: failures)
		.accessibilityHidden(true)
	}

	private func link(_ filled: Int) -> some View {
		let complete = filled >= InviteCode.codeLength
		return HStack(spacing: 12) {
			Image(systemName: "laptopcomputer")
				.font(.system(size: 42, weight: .light))
				.foregroundStyle(Theme.ink2)
			HStack(spacing: 5) {
				ForEach(0 ..< InviteCode.codeLength, id: \.self) { index in
					Circle()
						.fill(index < filled ? (complete ? Theme.green : Theme.ink) : Theme.line)
						.frame(width: 5, height: 5)
				}
			}
			Image(systemName: complete ? "iphone.radiowaves.left.and.right" : "iphone")
				.font(.system(size: 38, weight: .light))
				.foregroundStyle(complete ? Theme.green : Theme.ink2)
				.contentTransition(.symbolEffect(.replace))
				.symbolEffect(.bounce.down, options: .speed(1.6), value: filled)
		}
	}

	private var lock: some View {
		let digits: Int = if case let .password(filled) = stage { filled } else { 0 }
		return Image(systemName: stage == .paired ? "lock.open.fill" : "lock.fill")
			.font(.system(size: 50, weight: .regular))
			.foregroundStyle(stage == .paired ? Theme.green : Theme.ink)
			.contentTransition(.symbolEffect(.replace))
			.symbolEffect(.bounce.down, options: .speed(1.6), value: digits)
			.symbolEffect(.breathe, isActive: stage == .connecting)
	}
}

/// One box per character, the next one to fill outlined while typing.
private struct CodeBoxes: View {
	var value: String
	var length: Int
	var split: Int?
	var active: Bool
	var failed: Bool

	var body: some View {
		let characters = Array(value)
		HStack(spacing: 6) {
			ForEach(0 ..< length, id: \.self) { index in
				if index == split {
					Text("–").font(.system(size: 20, weight: .medium)).foregroundStyle(Theme.faint)
				}
				box(index < characters.count ? String(characters[index]) : nil, current: active && index == characters.count)
			}
		}
	}

	private func box(_ character: String?, current: Bool) -> some View {
		RoundedRectangle(cornerRadius: 12, style: .continuous)
			.fill(Theme.card)
			.strokeBorder(failed ? Theme.red : current ? Theme.ink : Theme.line, lineWidth: current || failed ? 1.5 : 1)
			.frame(maxWidth: 52)
			.frame(height: 54)
			.overlay {
				if let character {
					Text(character).font(.mono(24, weight: .semibold)).foregroundStyle(Theme.ink)
				} else if current {
					Capsule().fill(Theme.ink).frame(width: 2, height: 22)
				}
			}
	}
}

/// A short sideways shake when a code or password is turned down.
private nonisolated struct Shake: GeometryEffect {
	var animatableData: CGFloat

	func effectValue(size: CGSize) -> ProjectionTransform {
		ProjectionTransform(CGAffineTransform(translationX: 8 * sin(animatableData * .pi * 4), y: 0))
	}
}
