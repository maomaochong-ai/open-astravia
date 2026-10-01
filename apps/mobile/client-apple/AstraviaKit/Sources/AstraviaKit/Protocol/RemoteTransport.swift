import Foundation

public struct RemoteTransportHandlers {
	public var onFrame: (RemoteFrame) -> Void
	public var onClose: (String?) -> Void

	public init(onFrame: @escaping (RemoteFrame) -> Void, onClose: @escaping (String?) -> Void) {
		self.onFrame = onFrame
		self.onClose = onClose
	}
}

/// One bidirectional frame channel. `send` enqueues synchronously so frames
/// leave in call order, exactly like `WebSocket.send` in the TypeScript client.
public protocol RemoteTransport: AnyObject {
	func connect(_ handlers: RemoteTransportHandlers) async throws
	func send(_ frame: RemoteFrame) throws
	/// `reason` is surfaced to the peer where the transport can carry it (WebSocket close reason).
	func close(reason: String?)
}

public struct RemoteTransportError: Error, LocalizedError {
	public let message: String
	public init(_ message: String) { self.message = message }
	public var errorDescription: String? { message }
}

/// Runs `body` on the main actor after `ms` milliseconds unless the returned task is cancelled.
@discardableResult
public func schedule(after ms: Double, _ body: @escaping @MainActor () -> Void) -> Task<Void, Never> {
	Task { @MainActor in
		if ms > 0 { try? await Task.sleep(nanoseconds: UInt64(ms * 1_000_000)) }
		guard !Task.isCancelled else { return }
		body()
	}
}

/// Minimal multicast listener list; returns an unsubscribe closure like the TypeScript `onEvent`.
public final class Listeners<Value> {
	private var entries: [(id: Int, callback: (Value) -> Void)] = []
	private var nextId = 0

	public init() {}

	@discardableResult
	public func add(_ callback: @escaping (Value) -> Void) -> () -> Void {
		nextId += 1
		let id = nextId
		entries.append((id, callback))
		return { [weak self] in self?.entries.removeAll { $0.id == id } }
	}

	public func emit(_ value: Value) {
		for entry in entries { entry.callback(value) }
	}

	public var isEmpty: Bool { entries.isEmpty }
}
