import Foundation
@preconcurrency import WebRTC

/// The WebRTC renderer boundary, called on its video worker thread.
final class RemoteVideoRenderer: NSObject, RTCVideoRenderer, @unchecked Sendable {
	// RTCVideoRenderer accepts worker-thread callbacks; the sink owns its synchronization.
	nonisolated(unsafe) private let sink: any RTCVideoRenderer

	init(sink: any RTCVideoRenderer) { self.sink = sink }

	nonisolated func setSize(_ size: CGSize) { sink.setSize(size) }

	nonisolated func renderFrame(_ frame: RTCVideoFrame?) {
		guard let frame, frame.timeStampNs == 0 else {
			sink.renderFrame(frame)
			return
		}
		// Forced immediate playout can omit the presentation time. Metal uses it
		// to deduplicate frames (starting at zero), so each arrival needs an ID.
		// Share the pixels without mutating a frame that other sinks may still use.
		let displayFrame = RTCVideoFrame(
			buffer: frame.buffer,
			rotation: frame.rotation,
			timeStampNs: Int64(DispatchTime.now().uptimeNanoseconds)
		)
		displayFrame.timeStamp = frame.timeStamp
		sink.renderFrame(displayFrame)
	}
}
