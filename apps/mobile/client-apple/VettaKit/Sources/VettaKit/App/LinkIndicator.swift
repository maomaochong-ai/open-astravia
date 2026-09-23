import Foundation

/// The link state as the work page shows it next to its title.
public enum LinkIndicator: Equatable, Sendable {
	case online
	case connecting
	case reconnecting(attempt: Int)
	/// Also covers a relay that is up while the desktop itself is away.
	case offline

	public init(_ link: LinkSnapshot) {
		switch link.status {
		case .online:
			self = link.peerOnline ? .online : .offline
		case .connecting:
			self = link.reconnectAttempt > 0 ? .reconnecting(attempt: link.reconnectAttempt) : .connecting
		case .offline:
			// Nothing has failed yet: the first attempt is about to start
			// (launch, or back from the background).
			self = link.lastError == nil && link.reconnectAttempt == 0 ? .connecting : .offline
		}
	}
}
