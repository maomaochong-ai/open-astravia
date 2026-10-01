import Foundation

public extension LinkChannel {
	/// How the phone reaches the computer, as the link status line names it.
	var label: String {
		switch self {
		case .p2p: L10n.Settings.viaP2p
		case .lan: L10n.Settings.viaLan
		case .relay: L10n.Settings.viaRelay
		}
	}
}
