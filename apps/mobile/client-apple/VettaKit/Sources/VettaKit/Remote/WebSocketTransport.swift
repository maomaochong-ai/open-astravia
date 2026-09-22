import Foundation

/// `URLSessionWebSocketTask` adapter for the remote protocol (port of
/// `websocket-transport.ts`). The pairing secret travels as a WebSocket
/// subprotocol so it never appears in URLs, proxies or logs.
public final class WebSocketTransport: NSObject, RemoteTransport, @unchecked Sendable {
	public static let remoteProtocol = "vetta.remote.v2"
	public static let pairingProtocolPrefix = "vetta.pairing."
	public static let manualPairingProtocol = "vetta.manual"
	public static let closeCodeRejected = 4003
	static let keepalivePing = "ping"
	static let keepalivePong = "pong"

	private let url: String
	private let options: TransportOptions
	private var session: URLSession?
	private var task: URLSessionWebSocketTask?
	private var handlers: RemoteTransportHandlers?
	private var openContinuation: CheckedContinuation<Void, Error>?
	private var keepalive: Task<Void, Never>?
	private var closed = false

	public init(url: String, options: TransportOptions) {
		self.url = url
		self.options = options
	}

	public static func protocols(for options: TransportOptions) -> [String] {
		var protocols = [remoteProtocol]
		if let secret = options.pairingSecret, !secret.isEmpty {
			protocols.append(pairingProtocolPrefix + secret)
		} else if options.manual {
			protocols.append(manualPairingProtocol)
		}
		return protocols
	}

	public func connect(_ handlers: RemoteTransportHandlers) async throws {
		self.handlers = handlers
		guard let target = URL(string: url) else { throw RemoteTransportError("remote websocket URL is invalid") }
		let configuration = URLSessionConfiguration.ephemeral
		configuration.waitsForConnectivity = false
		configuration.timeoutIntervalForRequest = 15
		let session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
		let task = session.webSocketTask(with: target, protocols: Self.protocols(for: options))
		task.maximumMessageSize = 4 * 1024 * 1024
		self.session = session
		self.task = task
		try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
			openContinuation = continuation
			task.resume()
		}
		receive()
		startKeepalive()
	}

	public func send(_ frame: RemoteFrame) throws {
		guard let task, !closed else { throw RemoteTransportError("remote websocket is not connected") }
		task.send(.string(frame.encodedLine())) { _ in
			// A failing send surfaces through the close callback.
		}
	}

	public func close(reason: String?) {
		stopKeepalive()
		guard let task, !closed else { return }
		closed = true
		if let reason {
			let code = URLSessionWebSocketTask.CloseCode(rawValue: Self.closeCodeRejected) ?? .policyViolation
			task.cancel(with: code, reason: Data(reason.prefix(120).utf8))
		} else {
			task.cancel(with: .normalClosure, reason: nil)
		}
		session?.finishTasksAndInvalidate()
		self.task = nil
	}

	private func receive() {
		task?.receive { [weak self] result in
			MainActor.assumeIsolated {
				guard let self else { return }
				switch result {
				case let .success(message):
					self.handleMessage(message)
					if !self.closed { self.receive() }
				case let .failure(error):
					self.finish(reason: error.localizedDescription)
				}
			}
		}
	}

	private func handleMessage(_ message: URLSessionWebSocketTask.Message) {
		guard case let .string(text) = message else {
			finish(reason: "remote websocket returned a non-text frame")
			return
		}
		for line in text.split(separator: "\n") where !line.isEmpty {
			if line == Self.keepalivePong || line == Self.keepalivePing { continue }
			do {
				handlers?.onFrame(try RemoteFrame.parse(line: String(line)))
			} catch {
				finish(reason: "remote websocket returned an invalid frame")
				return
			}
		}
	}

	/// Reports the end of the socket exactly once.
	private func finish(reason: String?) {
		stopKeepalive()
		if let continuation = openContinuation {
			openContinuation = nil
			continuation.resume(throwing: RemoteTransportError(reason ?? "remote websocket connection failed"))
		}
		let wasClosed = closed
		closed = true
		task?.cancel()
		task = nil
		session?.finishTasksAndInvalidate()
		session = nil
		if !wasClosed { handlers?.onClose(reason) }
	}

	private func startKeepalive() {
		guard let interval = options.keepaliveIntervalMs, interval > 0 else { return }
		stopKeepalive()
		keepalive = Task { [weak self] in
			while !Task.isCancelled {
				try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000))
				guard !Task.isCancelled, let self, let task = self.task, !self.closed else { return }
				task.send(.string(Self.keepalivePing)) { _ in }
			}
		}
	}

	private func stopKeepalive() {
		keepalive?.cancel()
		keepalive = nil
	}
}

extension WebSocketTransport: URLSessionWebSocketDelegate {
	nonisolated public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
		MainActor.assumeIsolated {
			guard let continuation = openContinuation else { return }
			openContinuation = nil
			continuation.resume()
		}
	}

	nonisolated public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
		MainActor.assumeIsolated {
			let text = reason.flatMap { String(data: $0, encoding: .utf8) }
			finish(reason: text?.isEmpty == false ? text : "remote websocket closed (\(closeCode.rawValue))")
		}
	}

	nonisolated public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
		MainActor.assumeIsolated {
			guard task === self.task || openContinuation != nil else { return }
			finish(reason: error?.localizedDescription ?? "remote websocket connection failed")
		}
	}
}
