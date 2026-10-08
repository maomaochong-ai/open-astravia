import UIKit
import XCTest
import VettaKit
@preconcurrency import WebRTC
@testable import VettaRTC

final class RemoteScreenSurfaceTests: XCTestCase {
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
