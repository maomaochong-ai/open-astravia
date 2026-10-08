import Testing
@testable import VettaKit

@Suite struct RemoteTwoFingerGestureTests {
	@Test func scrollsThenZoomsAndPansInSeparateGestures() {
		var gesture = RemoteTwoFingerGesture()
		gesture.beginPan(zoomed: false)
		#expect(gesture.scroll(travel: 30) == nil)
		#expect(gesture.scroll(travel: 30) == .pointerScroll(deltaX: 0, deltaY: 120))
		gesture.beginPinch()
		#expect(!gesture.transformsPicture, "a scroll does not turn into a pinch mid-gesture")
		gesture.endPinch()
		#expect(gesture.scroll(travel: -60) == .pointerScroll(deltaX: 0, deltaY: -120))
		gesture.endPan()

		gesture.beginPinch()
		gesture.beginPan(zoomed: false)
		#expect(gesture.transformsPicture, "a pinch can also move the picture")
		#expect(gesture.scroll(travel: 100) == nil)
		gesture.endPan()
		#expect(gesture.transformsPicture, "ending one recognizer keeps the other one's gesture")
		gesture.endPinch()
		#expect(!gesture.transformsPicture)
		gesture.beginPan(zoomed: true)
		#expect(gesture.transformsPicture)
		#expect(gesture.scroll(travel: 100) == nil, "a zoomed picture pans without scrolling the computer")
	}

	@Test func liftingOrCancellingDiscardsPartialNotches() {
		var gesture = RemoteTwoFingerGesture()
		gesture.beginPan(zoomed: false)
		#expect(gesture.scroll(travel: 47) == nil)
		gesture.reset()
		gesture.beginPan(zoomed: false)
		#expect(gesture.scroll(travel: 1) == nil)
		#expect(gesture.scroll(travel: 47) == .pointerScroll(deltaX: 0, deltaY: 120))
	}

	@Test func fastTravelStaysWithinTheWireProtocolLimit() throws {
		var gesture = RemoteTwoFingerGesture()
		gesture.beginPan(zoomed: false)
		let scrolled = gesture.scroll(travel: 100_000)
		let command = try #require(scrolled)
		#expect(command == .pointerScroll(deltaX: 0, deltaY: RemoteDesktopProtocol.maxScrollDelta))
		_ = try RemoteDesktopProtocol.encode(command, sequence: 1)
	}
}
