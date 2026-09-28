import SwiftUI
import UIKit
import UniformTypeIdentifiers
import VettaKit

/// The phone's keyboard, typing on the desktop. A hidden text view holds it, so what the
/// input method composes (pinyin, say) reaches the desktop as the characters picked, not
/// the letters spelled; Delete presses Backspace and Return presses Enter. Above it, a bar
/// of the keys a phone keyboard lacks: Esc, Tab, the arrows, and ⌃ ⌥ ⌘ ⇧, each armed for
/// the next key by a tap and locked by a double tap; and Paste, which types the phone's
/// clipboard on the desktop. A hardware keyboard's shortcuts and non-typing keys go
/// straight through as keys.
public struct RemoteKeyboard: UIViewRepresentable {
	@Binding var open: Bool
	let onInput: ([RemoteInputCommand]) -> Void

	public init(open: Binding<Bool>, onInput: @escaping ([RemoteInputCommand]) -> Void) {
		_open = open
		self.onInput = onInput
	}

	public func makeUIView(context: Context) -> RemoteKeyInput {
		RemoteKeyInput()
	}

	public func updateUIView(_ view: RemoteKeyInput, context: Context) {
		view.onInput = onInput
		view.onClosed = { open = false }
		if open, !view.isFirstResponder {
			view.becomeFirstResponder()
		} else if !open, view.isFirstResponder {
			_ = view.resignFirstResponder()
		}
	}
}

public final class RemoteKeyInput: UITextView, UITextViewDelegate {
	/// Stands in an otherwise empty field so Delete still reaches `deleteBackward`.
	private static let sentinel = "\u{200B}"

	var onInput: ([RemoteInputCommand]) -> Void = { _ in }
	var onClosed: () -> Void = {}
	private var latch = ModifierLatch()
	private let bar = ModifierBar()
	private let keyFeel = UIImpactFeedbackGenerator(style: .light)

	init() {
		super.init(frame: CGRect(x: 0, y: 0, width: 1, height: 1), textContainer: nil)
		alpha = 0.01
		tintColor = .clear
		autocorrectionType = .no
		autocapitalizationType = .none
		spellCheckingType = .no
		smartQuotesType = .no
		smartDashesType = .no
		smartInsertDeleteType = .no
		keyboardAppearance = .dark
		text = Self.sentinel
		delegate = self
		pasteConfiguration = UIPasteConfiguration(acceptableTypeIdentifiers: [UTType.plainText.identifier])
		bar.frame = CGRect(x: 0, y: 0, width: 0, height: 48)
		bar.keyInput = self
		inputAccessoryView = bar
		accessibilityLabel = L10n.Remote.keyboard
	}

	@available(*, unavailable)
	required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

	public override func resignFirstResponder() -> Bool {
		let resigned = super.resignFirstResponder()
		if resigned { onClosed() }
		return resigned
	}

	// MARK: Typing

	public func textViewDidChange(_ textView: UITextView) {
		// A word still being composed stays until the input method commits it.
		guard markedTextRange == nil else { return }
		let typed = (text ?? "").replacingOccurrences(of: Self.sentinel, with: "")
		text = Self.sentinel
		guard !typed.isEmpty else { return }
		send(RemoteKeys.typing(typed, modifiers: latch.held))
	}

	public override func deleteBackward() {
		if markedTextRange != nil || (text ?? "") != Self.sentinel {
			super.deleteBackward()
			return
		}
		send(RemoteKeys.press("Backspace", modifiers: latch.held))
	}

	/// Keys from the bar: Esc, Tab and the arrows, with whatever modifiers are armed.
	fileprivate func press(_ code: String) {
		keyFeel.impactOccurred()
		send(RemoteKeys.press(code, modifiers: latch.held))
	}

	fileprivate func tap(_ modifier: RemoteKeyModifier) {
		keyFeel.impactOccurred()
		latch.tap(modifier, at: WallClock.nowMs())
		bar.show(latch)
	}

	private func send(_ commands: [RemoteInputCommand]) {
		guard !commands.isEmpty else { return }
		onInput(commands)
		latch.consume()
		bar.show(latch)
	}

	// MARK: Paste

	public override func paste(itemProviders: [NSItemProvider]) {
		for provider in itemProviders where provider.canLoadObject(ofClass: NSString.self) {
			_ = provider.loadObject(ofClass: NSString.self) { [weak self] value, _ in
				guard let text = value as? String else { return }
				DispatchQueue.main.async {
					MainActor.assumeIsolated { self?.onInput(RemoteDesktopProtocol.typing(text)) }
				}
			}
		}
	}

	// MARK: Hardware keyboard

	public override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
		if !forward(presses, action: .down) { super.pressesBegan(presses, with: event) }
	}

	public override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
		if !forward(presses, action: .up) { super.pressesEnded(presses, with: event) }
	}

	/// Shortcuts (⌘, ⌃ or ⌥ held) and keys that type nothing go to the desktop as keys;
	/// the rest is typed text, composed by the input method first.
	private func forward(_ presses: Set<UIPress>, action: RemoteKeyAction) -> Bool {
		var handled = false
		for press in presses {
			guard let key = press.key, let code = RemoteKeys.code(forHIDUsage: key.keyCode.rawValue) else { continue }
			if code.hasSuffix("Left"), code.hasPrefix("Meta") || code.hasPrefix("Control") || code.hasPrefix("Alt") || code.hasPrefix("Shift") {
				continue
			}
			let modifiers = Self.modifiers(key.modifierFlags)
			let shortcut = modifiers.contains(.meta) || modifiers.contains(.control) || modifiers.contains(.alt)
			// Return, Tab and Delete type through the text view like the on-screen keys do.
			let typed = ["Enter", "Tab", "Backspace"].contains(code)
			guard shortcut || (RemoteKeys.isControlKey(code) && !typed) else { continue }
			handled = true
			if action == .down { onInput(RemoteKeys.press(code, modifiers: modifiers)) }
		}
		return handled
	}

	private static func modifiers(_ flags: UIKeyModifierFlags) -> [RemoteKeyModifier] {
		var held: [RemoteKeyModifier] = []
		if flags.contains(.alternate) { held.append(.alt) }
		if flags.contains(.control) { held.append(.control) }
		if flags.contains(.command) { held.append(.meta) }
		if flags.contains(.shift) { held.append(.shift) }
		return held
	}
}

/// The bar above the keyboard.
private final class ModifierBar: UIInputView {
	weak var keyInput: RemoteKeyInput?
	private var modifierButtons: [RemoteKeyModifier: UIButton] = [:]

	init() {
		super.init(frame: CGRect(x: 0, y: 0, width: 0, height: 48), inputViewStyle: .keyboard)
		allowsSelfSizing = true
		let scroll = UIScrollView()
		scroll.showsHorizontalScrollIndicator = false
		scroll.translatesAutoresizingMaskIntoConstraints = false
		let row = UIStackView()
		row.axis = .horizontal
		row.spacing = 6
		row.translatesAutoresizingMaskIntoConstraints = false
		scroll.addSubview(row)
		addSubview(scroll)
		NSLayoutConstraint.activate([
			scroll.leadingAnchor.constraint(equalTo: leadingAnchor),
			scroll.trailingAnchor.constraint(equalTo: trailingAnchor),
			scroll.topAnchor.constraint(equalTo: topAnchor),
			scroll.bottomAnchor.constraint(equalTo: bottomAnchor),
			heightAnchor.constraint(equalToConstant: 48),
			row.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 8),
			row.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -8),
			row.centerYAnchor.constraint(equalTo: scroll.centerYAnchor),
			row.heightAnchor.constraint(equalToConstant: 36),
		])

		row.addArrangedSubview(key("esc", label: "Esc", code: "Escape"))
		row.addArrangedSubview(key("tab", label: "Tab", code: "Tab"))
		for (modifier, symbol, name) in [
			(RemoteKeyModifier.control, "⌃", "Control"),
			(.alt, "⌥", "Option"),
			(.meta, "⌘", "Command"),
			(.shift, "⇧", "Shift"),
		] {
			let button = cap(symbol, accessibility: name)
			button.addAction(UIAction { [weak self] _ in self?.keyInput?.tap(modifier) }, for: .touchUpInside)
			modifierButtons[modifier] = button
			row.addArrangedSubview(button)
		}
		for (symbol, code, name) in [("arrow.left", "ArrowLeft", "Left"), ("arrow.up", "ArrowUp", "Up"), ("arrow.down", "ArrowDown", "Down"), ("arrow.right", "ArrowRight", "Right")] {
			let button = cap(nil, symbol: symbol, accessibility: name)
			button.addAction(UIAction { [weak self] _ in self?.keyInput?.press(code) }, for: .touchUpInside)
			row.addArrangedSubview(button)
		}
		// UIPasteControl reads the clipboard only when tapped, without the "Allow Paste?" prompt.
		let configuration = UIPasteControl.Configuration()
		configuration.displayMode = .iconAndLabel
		configuration.cornerStyle = .capsule
		configuration.baseBackgroundColor = .tertiarySystemFill
		configuration.baseForegroundColor = .label
		let paste = UIPasteControl(configuration: configuration)
		paste.accessibilityIdentifier = "remote.paste"
		row.addArrangedSubview(paste)
		let hide = cap(nil, symbol: "keyboard.chevron.compact.down", accessibility: L10n.Remote.hideKeyboard)
		hide.addAction(UIAction { [weak self] _ in _ = self?.keyInput?.resignFirstResponder() }, for: .touchUpInside)
		row.addArrangedSubview(hide)
	}

	@available(*, unavailable)
	required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

	override func didMoveToWindow() {
		super.didMoveToWindow()
		for view in allSubviews(of: self) {
			(view as? UIPasteControl)?.target = keyInput
		}
	}

	func show(_ latch: ModifierLatch) {
		for (modifier, button) in modifierButtons {
			let state = latch.state(modifier)
			var configuration = button.configuration ?? .gray()
			configuration.baseBackgroundColor = state == .off ? .tertiarySystemFill : .tintColor
			configuration.baseForegroundColor = state == .off ? .label : .white
			configuration.background.strokeWidth = state == .locked ? 2 : 0
			configuration.background.strokeColor = .white
			button.configuration = configuration
			button.accessibilityValue = switch state {
			case .off: nil
			case .once: L10n.Remote.modifierOn
			case .locked: L10n.Remote.modifierLocked
			}
		}
	}

	private func key(_ identifier: String, label: String, code: String) -> UIButton {
		let button = cap(label, accessibility: label)
		button.accessibilityIdentifier = "remote.key.\(identifier)"
		button.addAction(UIAction { [weak self] _ in self?.keyInput?.press(code) }, for: .touchUpInside)
		return button
	}

	private func cap(_ title: String?, symbol: String? = nil, accessibility: String) -> UIButton {
		var configuration = UIButton.Configuration.gray()
		configuration.title = title
		configuration.image = symbol.flatMap { UIImage(systemName: $0) }
		configuration.cornerStyle = .medium
		configuration.baseBackgroundColor = .tertiarySystemFill
		configuration.baseForegroundColor = .label
		configuration.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12)
		let button = UIButton(configuration: configuration)
		button.accessibilityLabel = accessibility
		return button
	}

	private func allSubviews(of view: UIView) -> [UIView] {
		view.subviews + view.subviews.flatMap(allSubviews(of:))
	}
}
