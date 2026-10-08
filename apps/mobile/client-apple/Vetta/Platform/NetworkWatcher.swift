import Foundation
import Network
import VettaKit

/// Tells the model when the phone moves to another network (Wi-Fi to cellular, back online),
/// so the link moves with it. A handover reports several paths in a row: only the one it
/// settles on counts.
final class NetworkWatcher {
	private static let settleSeconds = 1.0

	private let monitor = NWPathMonitor()
	private var last: NetworkRoute?
	private var settling: Task<Void, Never>?

	init(onChange: @escaping @MainActor () -> Void) {
		monitor.pathUpdateHandler = { [weak self] path in
			let satisfied = path.status == .satisfied
			let interfaces = Self.interfaces(path)
			// Started on the main queue, so the handler already runs there.
			MainActor.assumeIsolated {
				self?.observe(NetworkRoute(satisfied: satisfied, interfaces: interfaces), onChange: onChange)
			}
		}
		monitor.start(queue: .main)
	}

	deinit {
		monitor.cancel()
	}

	private func observe(_ route: NetworkRoute, onChange: @escaping @MainActor () -> Void) {
		let changed = route.isChange(from: last)
		last = route
		guard changed else { return }
		settling?.cancel()
		settling = Task {
			try? await Task.sleep(for: .seconds(Self.settleSeconds))
			guard !Task.isCancelled else { return }
			onChange()
		}
	}

	private nonisolated static func interfaces(_ path: NWPath) -> Set<String> {
		let kinds: [(NWInterface.InterfaceType, String)] = [(.wifi, "wifi"), (.cellular, "cellular"), (.wiredEthernet, "wired"), (.other, "other")]
		return Set(kinds.filter { path.usesInterfaceType($0.0) }.map(\.1))
	}
}
