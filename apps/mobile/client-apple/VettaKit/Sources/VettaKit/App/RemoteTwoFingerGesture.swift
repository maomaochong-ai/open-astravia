import Foundation

/// Locks a two-finger gesture to scrolling or transforming the picture until both
/// fingers lift. A pinch and pan may be recognized together; a scroll must never zoom.
public struct RemoteTwoFingerGesture: Sendable {
	private enum Mode { case scroll, transform }
	private var mode: Mode?
	private var wheel = WheelNotches()
	private var panning = false
	private var pinching = false

	public init() {}

	public var transformsPicture: Bool { mode == .transform }

	public mutating func beginPan(zoomed: Bool) {
		panning = true
		if mode == nil { mode = zoomed ? .transform : .scroll }
	}

	public mutating func beginPinch() {
		pinching = true
		if mode == nil { mode = .transform }
	}

	public mutating func endPan() {
		panning = false
		if !pinching { reset() }
	}

	public mutating func endPinch() {
		pinching = false
		if !panning { reset() }
	}

	public mutating func scroll(travel: Double) -> RemoteInputCommand? {
		guard mode == .scroll else { return nil }
		let notches = wheel.add(travel)
		guard notches != 0 else { return nil }
		let delta = min(max(Double(notches) * WheelNotches.wheelDelta, -RemoteDesktopProtocol.maxScrollDelta), RemoteDesktopProtocol.maxScrollDelta)
		return .pointerScroll(deltaX: 0, deltaY: delta)
	}

	public mutating func reset() {
		mode = nil
		wheel.reset()
		panning = false
		pinching = false
	}
}
