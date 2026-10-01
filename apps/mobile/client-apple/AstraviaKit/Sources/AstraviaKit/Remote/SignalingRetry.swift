import Foundation

/// What a remote desktop session does when its signaling socket to the relay drops.
public enum SignalingDrop: Equatable, Sendable {
	/// Not connected directly yet: without signaling the session cannot finish setting up.
	case stop
	/// The direct link is up and never went through the relay: reopen signaling after this
	/// many seconds and keep the screen, input and control flowing meanwhile.
	case reconnect(after: Double)
}

/// Backs off reopening signaling while the relay is away (a restart, a deploy, a blip),
/// so a session connected directly outlives it. Mirrors the desktop's capture page.
public struct SignalingRetry: Equatable, Sendable {
	public static let firstDelay: Double = 1
	public static let maxDelay: Double = 30

	public private(set) var attempt = 0

	public init() {}

	public mutating func dropped(directlyConnected: Bool) -> SignalingDrop {
		guard directlyConnected else { return .stop }
		let delay = min(Self.firstDelay * pow(2, Double(attempt)), Self.maxDelay)
		attempt += 1
		return .reconnect(after: delay)
	}

	public mutating func reopened() {
		attempt = 0
	}
}
