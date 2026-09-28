import Foundation
import VettaKit
@preconcurrency import WebRTC

/// The encrypted remote-control protocol over the session's `vetta-control-v2` data
/// channel (ADR-0135): one frame per text message. Closing it ends the whole WebRTC
/// session, screen included.
final class P2PControlTransport: RemoteTransport {
	/// The desktop's own limit for one control message.
	private static let maxMessageBytes = 1_500_000

	private weak var session: RemoteDesktopSession?
	private var channel: RTCDataChannel?
	private var observer: ChannelObserver?
	private var handlers: RemoteTransportHandlers?
	private var opening: CheckedContinuation<Void, Error>?
	private var closed = false

	init(session: RemoteDesktopSession) {
		self.session = session
	}

	func connect(_ handlers: RemoteTransportHandlers) async throws {
		self.handlers = handlers
		if closed { throw RemoteTransportError("remote control data channel closed") }
		session?.start()
		if channel?.readyState == .open { return }
		try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
			if closed {
				continuation.resume(throwing: RemoteTransportError("remote control data channel closed"))
			} else {
				opening = continuation
			}
		}
	}

	func send(_ frame: RemoteFrame) throws {
		guard let channel, channel.readyState == .open, !closed else { throw RemoteTransportError("remote control data channel is not open") }
		guard channel.sendData(RTCDataBuffer(data: Data(frame.encodedLine().utf8), isBinary: false)) else {
			throw RemoteTransportError("remote control data channel rejected the frame")
		}
	}

	func close(reason: String?) {
		channelClosed(reason ?? "remote control data channel closed")
		session?.stop(reason: reason ?? "closed")
	}

	func bind(_ next: RTCDataChannel) {
		guard channel == nil else {
			next.close()
			return
		}
		channel = next
		let observer = ChannelObserver(transport: self)
		self.observer = observer
		next.delegate = observer
		if next.readyState == .open { opened() }
	}

	func channelClosed(_ reason: String) {
		guard !closed else { return }
		closed = true
		if let opening {
			self.opening = nil
			opening.resume(throwing: RemoteTransportError(reason))
		}
		handlers?.onClose(reason)
	}

	fileprivate func opened() {
		guard let opening else { return }
		self.opening = nil
		opening.resume()
	}

	fileprivate func stateChanged(_ state: RTCDataChannelState) {
		switch state {
		case .open: opened()
		case .closing, .closed: channelClosed("remote control data channel closed")
		default: break
		}
	}

	fileprivate func received(_ buffer: RTCDataBuffer) {
		guard !closed else { return }
		guard !buffer.isBinary, buffer.data.count <= Self.maxMessageBytes, let text = String(data: buffer.data, encoding: .utf8) else {
			channel?.close()
			channelClosed("invalid remote control data channel payload")
			return
		}
		do {
			handlers?.onFrame(try RemoteFrame.parse(line: text.trimmingCharacters(in: .whitespacesAndNewlines)))
		} catch {
			channel?.close()
			channelClosed("invalid remote control data channel frame")
		}
	}
}

/// The data channel's callbacks, moved onto the main actor in the order they came.
private final class ChannelObserver: NSObject, RTCDataChannelDelegate, @unchecked Sendable {
	/// Read only on the main queue, where every callback hops before touching it.
	nonisolated(unsafe) private weak var transport: P2PControlTransport?

	init(transport: P2PControlTransport) { self.transport = transport }

	nonisolated func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
		let state = dataChannel.readyState
		DispatchQueue.main.async { MainActor.assumeIsolated { self.transport?.stateChanged(state) } }
	}

	nonisolated func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
		DispatchQueue.main.async { MainActor.assumeIsolated { self.transport?.received(buffer) } }
	}
}
