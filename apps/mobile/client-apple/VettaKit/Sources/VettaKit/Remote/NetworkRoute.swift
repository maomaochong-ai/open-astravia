import Foundation

/// How the phone reaches the internet right now, as the system's path monitor reports it.
public struct NetworkRoute: Equatable, Sendable {
	public var satisfied: Bool
	/// Interface kinds in use ("wifi", "cellular", "wired", …), in any order.
	public var interfaces: Set<String>

	public init(satisfied: Bool, interfaces: Set<String>) {
		self.satisfied = satisfied
		self.interfaces = interfaces
	}

	/// Whether the link should move: the phone is online and got there another way than
	/// `previous`. The first reading and going offline are not changes: there is nothing to
	/// compare with, or nowhere to reconnect to.
	public func isChange(from previous: NetworkRoute?) -> Bool {
		guard let previous, satisfied else { return false }
		return !previous.satisfied || interfaces != previous.interfaces
	}
}
