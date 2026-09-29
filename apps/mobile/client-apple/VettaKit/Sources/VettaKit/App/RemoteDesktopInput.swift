import Foundation

/// The desktop's picture as the phone shows it: zoomed in by a pinch (1x to `maxZoom`)
/// about the view's centre and panned, never so far that the view shows past the
/// picture's edge. Maps a touch on the view back to where it lands on the desktop.
/// Port of Android's `RemoteViewport`.
public struct RemoteViewport: Equatable, Sendable {
	public static let maxZoom = 4.0

	public var zoom: Double
	public var panX: Double
	public var panY: Double

	public init(zoom: Double = 1, panX: Double = 0, panY: Double = 0) {
		self.zoom = zoom
		self.panX = panX
		self.panY = panY
	}

	public var zoomed: Bool { zoom > 1.01 }

	/// Zooms by `factor` about `focus` (the fingers' midpoint on the view) and moves by
	/// the fingers' travel, keeping the desktop point under the fingers under them.
	public func transformed(factor: Double, focusX: Double, focusY: Double, moveX: Double, moveY: Double, width: Double, height: Double) -> RemoteViewport {
		let next = min(max(zoom * factor, 1), Self.maxZoom)
		let cx = width / 2
		let cy = height / 2
		// The picture point under the fingers before, placed back under them after.
		let px = cx + (focusX - cx - panX) / zoom
		let py = cy + (focusY - cy - panY) / zoom
		let x = focusX - cx - (px - cx) * next + moveX
		let y = focusY - cy - (py - cy) * next + moveY
		return RemoteViewport(zoom: next, panX: Self.clampPan(x, width, next), panY: Self.clampPan(y, height, next))
	}

	/// Where a point on the view lands on the desktop, from 0 to 1 across each side.
	public func toDesktop(x: Double, y: Double, width: Double, height: Double) -> (x: Double, y: Double) {
		guard width > 0, height > 0 else { return (0.5, 0.5) }
		let px = width / 2 + (x - width / 2 - panX) / zoom
		let py = height / 2 + (y - height / 2 - panY) / zoom
		return (min(max(px / width, 0), 1), min(max(py / height, 0), 1))
	}

	/// Where a desktop point (0…1) shows on the view, e.g. to place the magnifier over it.
	public func toView(x: Double, y: Double, width: Double, height: Double) -> (x: Double, y: Double) {
		(width / 2 + (x * width - width / 2) * zoom + panX, height / 2 + (y * height - height / 2) * zoom + panY)
	}

	private static func clampPan(_ value: Double, _ side: Double, _ zoom: Double) -> Double {
		let limit = (zoom - 1) * side / 2
		// Plus zero turns a -0 into 0, so an unmoved view equals the default.
		return max(-limit, min(limit, value)) + 0
	}

	/// The largest rectangle of the video's shape that fits `container`, centred: where
	/// the picture actually is, so touches on the bars around it land nowhere.
	public static func fitted(videoWidth: Double, videoHeight: Double, containerWidth: Double, containerHeight: Double) -> (x: Double, y: Double, width: Double, height: Double) {
		guard videoWidth > 0, videoHeight > 0, containerWidth > 0, containerHeight > 0 else {
			return (0, 0, containerWidth, containerHeight)
		}
		let scale = min(containerWidth / videoWidth, containerHeight / videoHeight)
		let width = videoWidth * scale
		let height = videoHeight * scale
		return ((containerWidth - width) / 2, (containerHeight - height) / 2, width, height)
	}
}

/// The phone as a trackpad (ADR-0140): the finger moves the cursor from where it is,
/// not to where the finger is. Travel is measured against the picture as shown, so a
/// zoomed picture gives finer control; faster moves go further, as on a Mac trackpad.
public struct RemoteTrackpad: Equatable, Sendable {
	/// Where the cursor is on the desktop, 0…1 across each side. The phone only knows
	/// where it put it: the desktop's own mouse moving it is not seen.
	public private(set) var cursor: (x: Double, y: Double) = (0.5, 0.5)

	public init() {}

	public static func == (lhs: RemoteTrackpad, rhs: RemoteTrackpad) -> Bool { lhs.cursor == rhs.cursor }

	/// How much further than the finger the cursor goes at `speed` points a second.
	public static func gain(speed: Double) -> Double {
		1 + min(max(speed - 200, 0) / 600, 2)
	}

	/// Moves by the finger's travel over a picture shown `width`×`height` points in size
	/// (zoom included); returns the move to send.
	public mutating func move(dx: Double, dy: Double, speed: Double, width: Double, height: Double) -> RemoteInputCommand? {
		guard width > 0, height > 0, dx != 0 || dy != 0 else { return nil }
		let gain = Self.gain(speed: speed)
		cursor = (min(max(cursor.x + dx * gain / width, 0), 1), min(max(cursor.y + dy * gain / height, 0), 1))
		return .pointerMove(x: cursor.x, y: cursor.y)
	}

	/// A click where the cursor is, as a tap sends it.
	public func click(_ button: RemotePointerButton) -> [RemoteInputCommand] {
		[
			.pointerMove(x: cursor.x, y: cursor.y),
			.pointerButton(x: cursor.x, y: cursor.y, button: button, action: .down),
			.pointerButton(x: cursor.x, y: cursor.y, button: button, action: .up),
		]
	}

	public func press(_ action: RemoteKeyAction) -> RemoteInputCommand {
		.pointerButton(x: cursor.x, y: cursor.y, button: .left, action: action)
	}
}

/// Two fingers' vertical travel as mouse-wheel notches: one notch per `step` points,
/// the remainder carried to the next move. Fingers moving down scroll the page back
/// up, as a touch screen does, which is a positive wheel delta. Port of Android's.
public struct WheelNotches: Sendable {
	/// A wheel notch in the desktop's units (Windows' WHEEL_DELTA).
	public static let wheelDelta = 120.0

	private let step: Double
	private var carried = 0.0

	public init(step: Double = 48) { self.step = step }

	public mutating func add(_ travel: Double) -> Int {
		carried += travel
		let notches = Int(carried / step)
		carried -= Double(notches) * step
		return notches
	}

	public mutating func reset() { carried = 0 }
}

/// Keys as the desktop presses them: DOM `code`s it maps to real keys on every system.
/// It knows letters, digits, Space, Enter, Tab, Escape, Backspace, Delete, the arrows,
/// Home, End, Page Up, Page Down and the left-hand modifiers; anything else printable
/// goes as typed text.
public enum RemoteKeys {
	public static func code(for modifier: RemoteKeyModifier) -> String {
		switch modifier {
		case .alt: "AltLeft"
		case .control: "ControlLeft"
		case .meta: "MetaLeft"
		case .shift: "ShiftLeft"
		}
	}

	/// The key a character sits on, with Shift for a capital; nil when the desktop has no
	/// key for it and it has to go as text.
	public static func stroke(for character: Character) -> (code: String, shift: Bool)? {
		guard let scalar = character.unicodeScalars.first, character.unicodeScalars.count == 1, scalar.isASCII else { return nil }
		let value = Character(scalar)
		switch value {
		case "a" ... "z": return ("Key\(value.uppercased())", false)
		case "A" ... "Z": return ("Key\(value)", true)
		case "0" ... "9": return ("Digit\(value)", false)
		case " ": return ("Space", false)
		case "\t": return ("Tab", false)
		case "\n", "\r": return ("Enter", false)
		default: return nil
		}
	}

	/// A key pressed with modifiers held, as a real keyboard sends it: each modifier goes
	/// down first and comes up last, because the desktop tracks held modifiers by their
	/// own key events.
	public static func press(_ code: String, modifiers: [RemoteKeyModifier] = []) -> [RemoteInputCommand] {
		let held = RemoteKeyModifier.allCases.filter(modifiers.contains)
		var commands = held.map { RemoteInputCommand.key(code: Self.code(for: $0), action: .down, modifiers: []) }
		commands.append(.key(code: code, action: .down, modifiers: held))
		commands.append(.key(code: code, action: .up, modifiers: held))
		commands += held.reversed().map { .key(code: Self.code(for: $0), action: .up, modifiers: []) }
		return commands
	}

	/// What typing `text` sends while `modifiers` are held: shortcuts such as ⌘C go key by
	/// key; with nothing held, plain text (see `RemoteDesktopProtocol.typing`).
	public static func typing(_ text: String, modifiers: [RemoteKeyModifier]) -> [RemoteInputCommand] {
		guard !modifiers.isEmpty else { return RemoteDesktopProtocol.typing(text) }
		return text.flatMap { character -> [RemoteInputCommand] in
			guard let stroke = stroke(for: character) else { return RemoteDesktopProtocol.typing(String(character)) }
			return press(stroke.code, modifiers: stroke.shift && !modifiers.contains(.shift) ? modifiers + [.shift] : modifiers)
		}
	}

	/// A hardware keyboard key by its USB HID usage (`UIKey.keyCode`), for the keys the
	/// desktop can press; printable keys without a modifier are left to typed text.
	public static func code(forHIDUsage usage: Int) -> String? {
		switch usage {
		case 0x04 ... 0x1D: return "Key\(Character(UnicodeScalar(UInt8(0x41 + usage - 0x04))))"
		case 0x1E ... 0x26: return "Digit\(usage - 0x1D)"
		case 0x27: return "Digit0"
		case 0x28, 0x58: return "Enter"
		case 0x29: return "Escape"
		case 0x2A: return "Backspace"
		case 0x2B: return "Tab"
		case 0x2C: return "Space"
		case 0x4A: return "Home"
		case 0x4B: return "PageUp"
		case 0x4C: return "Delete"
		case 0x4D: return "End"
		case 0x4E: return "PageDown"
		case 0x4F: return "ArrowRight"
		case 0x50: return "ArrowLeft"
		case 0x51: return "ArrowDown"
		case 0x52: return "ArrowUp"
		case 0xE0, 0xE4: return "ControlLeft"
		case 0xE1, 0xE5: return "ShiftLeft"
		case 0xE2, 0xE6: return "AltLeft"
		case 0xE3, 0xE7: return "MetaLeft"
		default: return nil
		}
	}

	/// Keys that type nothing, which a hardware keyboard sends as keys even without a
	/// modifier; printable ones go through the text field so the phone's input method
	/// (pinyin, say) composes them first.
	public static func isControlKey(_ code: String) -> Bool {
		!(code.hasPrefix("Key") || code.hasPrefix("Digit") || code == "Space")
	}
}

/// The modifier keys of the keyboard toolbar. A tap arms one for the next key and it
/// goes out after it; tapping it again within `doubleTapMs` locks it until tapped
/// once more.
public struct ModifierLatch: Equatable, Sendable {
	public enum State: Equatable, Sendable {
		case off, once, locked
	}

	public static let doubleTapMs = 350.0

	public private(set) var states: [RemoteKeyModifier: State] = [:]
	private var lastTap: [RemoteKeyModifier: Double] = [:]

	public init() {}

	public func state(_ modifier: RemoteKeyModifier) -> State { states[modifier] ?? .off }

	/// Held for the next key, in a fixed order.
	public var held: [RemoteKeyModifier] { RemoteKeyModifier.allCases.filter { state($0) != .off } }

	public mutating func tap(_ modifier: RemoteKeyModifier, at now: Double) {
		let quick = lastTap[modifier].map { now - $0 <= Self.doubleTapMs } ?? false
		lastTap[modifier] = now
		switch state(modifier) {
		case .off: states[modifier] = .once
		case .once: states[modifier] = quick ? .locked : .off
		case .locked: states[modifier] = .off
		}
	}

	/// A key went out: the modifiers armed for it go out too, locked ones stay.
	public mutating func consume() {
		for (modifier, state) in states where state == .once { states[modifier] = .off }
	}

	public mutating func reset() {
		states = [:]
		lastTap = [:]
	}
}
