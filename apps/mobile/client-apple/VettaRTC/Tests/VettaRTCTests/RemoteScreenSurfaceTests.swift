import MetalKit
import UIKit
import XCTest
import VettaKit
@preconcurrency import WebRTC
@testable import VettaRTC

final class RemoteScreenSurfaceTests: XCTestCase {
	private final class FrameSink: NSObject, RTCVideoRenderer {
		// These tests invoke the worker callbacks synchronously on one thread.
		nonisolated(unsafe) var frames: [RTCVideoFrame?] = []
		nonisolated(unsafe) var size = CGSize.zero
		func setSize(_ size: CGSize) { self.size = size }
		func renderFrame(_ frame: RTCVideoFrame?) { frames.append(frame) }
	}

	@MainActor func testFramesWithoutPresentationTimesRemainDistinctForTheMetalRenderer() throws {
		var pixels: CVPixelBuffer?
		XCTAssertEqual(CVPixelBufferCreate(kCFAllocatorDefault, 16, 16, kCVPixelFormatType_32BGRA, nil, &pixels), kCVReturnSuccess)
		let buffer = RTCCVPixelBuffer(pixelBuffer: try XCTUnwrap(pixels))
		let sink = FrameSink()
		let renderer = RemoteVideoRenderer(sink: sink)
		renderer.setSize(CGSize(width: 16, height: 16))
		let immediate = RTCVideoFrame(buffer: buffer, rotation: ._90, timeStampNs: 0)
		immediate.timeStamp = 1234
		renderer.renderFrame(immediate)
		renderer.renderFrame(immediate)
		let first = try XCTUnwrap(sink.frames[0])
		let second = try XCTUnwrap(sink.frames[1])
		XCTAssertGreaterThan(first.timeStampNs, 0, "Metal starts with lastFrameTimeNs = 0 and otherwise drops every immediate frame")
		XCTAssertGreaterThan(second.timeStampNs, first.timeStampNs, "successive immediate frames must not look like duplicates")
		XCTAssertTrue(first.buffer === buffer)
		XCTAssertEqual(first.rotation, ._90)
		XCTAssertEqual(first.timeStamp, 1234)
		XCTAssertEqual(immediate.timeStampNs, 0, "do not change the frame shared with other sinks")
		let timed = RTCVideoFrame(buffer: buffer, rotation: ._0, timeStampNs: 999)
		renderer.renderFrame(timed)
		renderer.renderFrame(nil)
		XCTAssertTrue(sink.frames[2] === timed, "normal presentation times keep their scheduling and deduplication")
		XCTAssertNil(sink.frames[3])
		XCTAssertEqual(sink.size, CGSize(width: 16, height: 16))
	}

	@MainActor private final class PanSample: UIPanGestureRecognizer {
		var phase: UIGestureRecognizer.State = .possible
		var travel = CGPoint.zero
		override var state: UIGestureRecognizer.State {
			get { phase }
			set { phase = newValue }
		}
		override func translation(in view: UIView?) -> CGPoint { travel }
	}

	@MainActor private final class PinchSample: UIPinchGestureRecognizer {
		var phase: UIGestureRecognizer.State = .possible
		override var state: UIGestureRecognizer.State {
			get { phase }
			set { phase = newValue }
		}
		override func location(in view: UIView?) -> CGPoint { CGPoint(x: 200, y: 400) }
	}

	/// Feed recognized UIKit samples to the view's action handlers. A unit-test runner
	/// has no application touch event stream to dispatch them on its own.
	@MainActor private func pan(_ recognizer: PanSample, on surface: RemoteScreenSurface, state: UIGestureRecognizer.State, y: CGFloat = 0) {
		recognizer.travel = CGPoint(x: 0, y: y)
		recognizer.state = state
		surface.twoFingersMoved(recognizer)
	}

	/// The WebRTC size callback forwards to the main queue before laying out the picture.
	@MainActor private func deliverVideoSize() async {
		await withCheckedContinuation { continuation in
			DispatchQueue.main.async { continuation.resume() }
		}
	}

	@MainActor func testVideoDisplayBudgetSurvivesFirstFrameZoomRotationAndDecoderChanges() async throws {
		let surface = RemoteScreenSurface()
		surface.frame = CGRect(x: 0, y: 0, width: 400, height: 800)
		surface.traitOverrides.displayScale = 3
		let video = try XCTUnwrap(surface.subviews.compactMap { $0 as? RTCMTLVideoView }.first)
		let metal = try XCTUnwrap(video.subviews.compactMap { $0 as? MTKView }.first)
		let renderer = RemoteVideoRenderer(sink: video)

		var pixels: CVPixelBuffer?
		let attributes: [CFString: Any] = [kCVPixelBufferMetalCompatibilityKey: true, kCVPixelBufferIOSurfacePropertiesKey: [:]]
		XCTAssertEqual(CVPixelBufferCreate(kCFAllocatorDefault, 2560, 1600,
			kCVPixelFormatType_420YpCbCr8BiPlanarFullRange, attributes as CFDictionary, &pixels), kCVReturnSuccess)
		let nv12 = RTCCVPixelBuffer(pixelBuffer: try XCTUnwrap(pixels))

		// Match the track's worker callbacks, including immediate playout timestamps.
		func display(_ buffer: any RTCVideoFrameBuffer, rotation: RTCVideoRotation = ._0) async {
			let rotated = rotation == ._90 || rotation == ._270
			let size = CGSize(width: Int(rotated ? buffer.height : buffer.width), height: Int(rotated ? buffer.width : buffer.height))
			await Task.detached { renderer.setSize(size) }.value
			renderer.renderFrame(RTCVideoFrame(buffer: buffer, rotation: rotation, timeStampNs: 0))
			await deliverVideoSize()
			await deliverVideoSize()
			surface.layoutIfNeeded()
			video.layoutIfNeeded()
			// Lazy initialization of each WebRTC pixel renderer used to restore 30 fps.
			metal.delegate?.draw(in: metal)
		}

		await display(nv12)
		XCTAssertEqual(metal.preferredFramesPerSecond, 60)
		XCTAssertEqual(metal.drawableSize, CGSize(width: 1200, height: 750), "draw at the visible physical size, not the source size times Retina scale")

		let pinch = PinchSample()
		pinch.state = .began
		surface.pinched(pinch)
		pinch.scale = 3
		pinch.state = .changed
		surface.pinched(pinch)
		video.layoutIfNeeded()
		XCTAssertEqual(metal.drawableSize, CGSize(width: 2560, height: 1600), "zoom preserves source detail without oversampling beyond it")
		pinch.state = .ended
		surface.pinched(pinch)

		// Turning the phone changes the viewport; turning the source changes pixel axes.
		surface.frame = CGRect(x: 0, y: 0, width: 800, height: 400)
		surface.layoutIfNeeded()
		video.layoutIfNeeded()
		XCTAssertEqual(metal.drawableSize, CGSize(width: 2560, height: 1600))
		await display(nv12, rotation: ._90)
		XCTAssertEqual(metal.drawableSize, CGSize(width: 750, height: 1200))
		XCTAssertEqual(metal.preferredFramesPerSecond, 60)

		// A software-decoded frame initializes a different shader, then hardware resumes.
		await display(RTCI420Buffer(width: 1280, height: 720))
		XCTAssertEqual(metal.drawableSize, CGSize(width: 1280, height: 720))
		XCTAssertEqual(metal.preferredFramesPerSecond, 60)
		await display(nv12)
		XCTAssertEqual(metal.drawableSize, CGSize(width: 1920, height: 1200))
		XCTAssertEqual(metal.preferredFramesPerSecond, 60)
	}

	@MainActor func testClosingVideoReleasesTheMetalDelegateAdapter() {
		weak var released: RemoteMetalVideoView?
		autoreleasepool {
			let view = RemoteMetalVideoView()
			released = view
		}
		XCTAssertNil(released, "the drawing delegate must not keep a closed video view alive")
	}

	@MainActor func testTwoFingerPanSendsWheelInputAndRespectsViewOnlyPermission() async throws {
		let surface = RemoteScreenSurface()
		surface.frame = CGRect(x: 0, y: 0, width: 400, height: 800)
		let video = try XCTUnwrap(surface.subviews.compactMap { $0 as? RTCMTLVideoView }.first)
		surface.videoView(video, didChangeVideoSize: CGSize(width: 1600, height: 900))
		await deliverVideoSize()
		surface.layoutIfNeeded()
		var commands: [RemoteInputCommand] = []
		surface.onInput = { commands += $0 }
		let installed = try XCTUnwrap(surface.gestureRecognizers?.compactMap { $0 as? UIPanGestureRecognizer }.first)
		XCTAssertEqual(installed.minimumNumberOfTouches, 2)
		XCTAssertEqual(installed.maximumNumberOfTouches, 2)
		XCTAssertTrue(installed.delegate === surface)
		let pan = PanSample()
		self.pan(pan, on: surface, state: .began)
		self.pan(pan, on: surface, state: .changed, y: 96)
		XCTAssertEqual(commands, [.pointerScroll(deltaX: 0, deltaY: 240)])
		self.pan(pan, on: surface, state: .ended)

		XCTAssertTrue(surface.gestureRecognizers?.contains { $0 is UIPinchGestureRecognizer } == true)
		let pinch = PinchSample()
		let original = video.frame
		pinch.state = .began
		surface.pinched(pinch)
		pinch.scale = 2
		pinch.state = .changed
		surface.pinched(pinch)
		XCTAssertEqual(video.frame.width, original.width * 2)
		self.pan(pan, on: surface, state: .began)
		let enlarged = video.frame
		self.pan(pan, on: surface, state: .changed, y: 48)
		XCTAssertNotEqual(video.frame.origin, enlarged.origin, "two fingers move the enlarged picture")
		XCTAssertEqual(commands.count, 1, "panning the picture does not scroll the computer")
		self.pan(pan, on: surface, state: .ended)
		pinch.scale = 1
		surface.pinched(pinch)
		pinch.state = .ended
		surface.pinched(pinch)
		XCTAssertEqual(video.frame, original)

		surface.interactive = false
		self.pan(pan, on: surface, state: .began)
		self.pan(pan, on: surface, state: .changed, y: 96)
		self.pan(pan, on: surface, state: .cancelled)
		XCTAssertEqual(commands.count, 1, "view-only permission never sends wheel input")
	}
}
