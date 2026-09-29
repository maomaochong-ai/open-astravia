import Foundation
import Observation
import VettaKit

/// One live WebRTC session per desktop, shared by the link (its control channel) and the
/// remote desktop page (its screen and input), like Android's `NativeRemoteDesktopSessions`.
/// A stopped session is replaced by the next P2P attempt; the page follows `session(for:)`.
@Observable
public final class RemoteDesktopSessions {
	public static let shared = RemoteDesktopSessions()

	private var sessions: [String: RemoteDesktopSession] = [:]

	private init() {}

	/// The session the link opened for `target`, while it lasts.
	public func session(for target: String) -> RemoteDesktopSession? {
		sessions[target].flatMap { $0.isStopped ? nil : $0 }
	}

	/// The session most recently opened for `target`, stopped or not: what the page shows
	/// while it waits for a connection.
	public func latest(for target: String) -> RemoteDesktopSession? {
		sessions[target]
	}

	/// For `ChannelManagerOptions.createP2pTransport`: a new session's control channel.
	/// Each P2P attempt starts afresh; a session left over from an earlier one is ended.
	public func transport(for target: String) -> RemoteTransport {
		sessions[target]?.stop(reason: "replaced by a new P2P attempt")
		let session = RemoteDesktopSession(target: target)
		sessions[target] = session
		// A fresh session always has its control channel unclaimed.
		return session.claimControlTransport()!
	}

	/// Ends every session, e.g. when the phone unpairs.
	public func stopAll() {
		for session in sessions.values { session.stop(reason: "stopped") }
		sessions.removeAll()
	}
}
