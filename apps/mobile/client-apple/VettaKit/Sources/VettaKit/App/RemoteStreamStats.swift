import Foundation

/// How the desktop's screen reaches the phone right now, from WebRTC's statistics, so a
/// slow picture can be told apart: a slow network, or a slow picture on a fast one.
public struct RemoteStreamStats: Equatable, Sendable {
	public enum Route: Equatable, Sendable {
		/// Both ends on the same network.
		case lan
		/// Straight between the two, across the internet.
		case internet
		/// Through a relay server.
		case relayed
	}

	public var route: Route?
	/// Network round trip of the WebRTC connection.
	public var roundTripMs: Double?
	public var framesPerSecond: Double?
	public var frameWidth: Int?
	public var frameHeight: Int?
	/// How long a frame waits on the phone before it is shown, on average.
	public var jitterBufferMs: Double?
	/// How long the phone takes to decode a frame, on average.
	public var decodeMs: Double?

	public init(route: Route? = nil, roundTripMs: Double? = nil, framesPerSecond: Double? = nil, frameWidth: Int? = nil, frameHeight: Int? = nil, jitterBufferMs: Double? = nil, decodeMs: Double? = nil) {
		self.route = route
		self.roundTripMs = roundTripMs
		self.framesPerSecond = framesPerSecond
		self.frameWidth = frameWidth
		self.frameHeight = frameHeight
		self.jitterBufferMs = jitterBufferMs
		self.decodeMs = decodeMs
	}

	/// From the two ends' ICE candidate types ("host", "srflx", "prflx", "relay").
	public static func route(local: String?, remote: String?) -> Route? {
		guard let local, let remote else { return nil }
		if local == "relay" || remote == "relay" { return .relayed }
		if local == "host", remote == "host" { return .lan }
		return .internet
	}

	/// About how old the picture is when shown, beyond the desktop's own capture and
	/// encoding, which the phone cannot see: half the round trip, the wait, the decode.
	public var pictureDelayMs: Double? {
		guard let roundTripMs else { return nil }
		return roundTripMs / 2 + (jitterBufferMs ?? 0) + (decodeMs ?? 0)
	}

	/// One line for the remote desktop page, e.g. "Direct on LAN · 8 ms · picture ≈40 ms · 60 fps".
	public var summary: String {
		var parts: [String] = []
		switch route {
		case .lan: parts.append(L10n.Remote.routeLan)
		case .internet: parts.append(L10n.Remote.routeInternet)
		case .relayed: parts.append(L10n.Remote.routeRelayed)
		case nil: break
		}
		if let roundTripMs { parts.append(L10n.Remote.roundTrip(Int(roundTripMs.rounded()))) }
		if let pictureDelayMs { parts.append(L10n.Remote.pictureDelay(Int(pictureDelayMs.rounded()))) }
		if let framesPerSecond { parts.append(L10n.Remote.framesPerSecond(Int(framesPerSecond.rounded()))) }
		if let frameWidth, let frameHeight { parts.append("\(frameWidth)×\(frameHeight)") }
		return parts.joined(separator: " · ")
	}
}
