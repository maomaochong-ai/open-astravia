import Foundation
import Testing
@testable import VettaKit

@Suite struct RemoteDesktopInputTests {
	private func near(_ a: Double, _ b: Double) -> Bool { abs(a - b) < 0.001 }

	@Test func mapsATouchStraightOntoTheDesktopWhenNotZoomed() {
		let viewport = RemoteViewport()
		let point = viewport.toDesktop(x: 100, y: 100, width: 400, height: 200)
		#expect(point == (0.25, 0.5))
		#expect(viewport.toDesktop(x: 1, y: 1, width: 0, height: 0) == (0.5, 0.5), "no size yet: the middle")
	}

	@Test func zoomingKeepsThePointUnderTheFingersAndMapsTouchesThroughIt() {
		// Pinch to 2x with the fingers over the view's top-left quarter point.
		let zoomed = RemoteViewport().transformed(factor: 2, focusX: 100, focusY: 50, moveX: 0, moveY: 0, width: 400, height: 200)
		#expect(zoomed.zoom == 2)
		let under = zoomed.toDesktop(x: 100, y: 50, width: 400, height: 200)
		#expect(near(under.x, 0.25) && near(under.y, 0.25))
		// The view's centre now shows a point between the focus and the old centre.
		let centre = zoomed.toDesktop(x: 200, y: 100, width: 400, height: 200)
		#expect(near(centre.x, 0.375) && near(centre.y, 0.375))
		let back = zoomed.toView(x: under.x, y: under.y, width: 400, height: 200)
		#expect(near(back.x, 100) && near(back.y, 50), "toView undoes toDesktop")
	}

	@Test func neverPansPastThePictureAndRecentresWhenZoomedOut() {
		let far = RemoteViewport().transformed(factor: 10, focusX: 200, focusY: 100, moveX: 5_000, moveY: -5_000, width: 400, height: 200)
		#expect(far.zoom == RemoteViewport.maxZoom)
		#expect(far.panX == 600, "at 4x a 400pt view can move 600pt either way")
		#expect(far.panY == -300)
		let back = far.transformed(factor: 0.01, focusX: 200, focusY: 100, moveX: 0, moveY: 0, width: 400, height: 200)
		#expect(back == RemoteViewport(), "zooming all the way out also recentres")
		#expect(!back.zoomed)
	}

	@Test func fitsThePictureBetweenBarsSoTouchesOnThemLandNowhere() {
		let wide = RemoteViewport.fitted(videoWidth: 1920, videoHeight: 1080, containerWidth: 390, containerHeight: 700)
		#expect(near(wide.width, 390) && near(wide.height, 219.375) && wide.x == 0 && near(wide.y, 240.3125))
		let tall = RemoteViewport.fitted(videoWidth: 1080, videoHeight: 1920, containerWidth: 800, containerHeight: 400)
		#expect(near(tall.height, 400) && near(tall.width, 225) && near(tall.x, 287.5))
		#expect(RemoteViewport.fitted(videoWidth: 0, videoHeight: 0, containerWidth: 10, containerHeight: 20) == (0, 0, 10, 20))
	}

	@Test func turnsFingerTravelIntoWheelNotchesCarryingTheRest() {
		var wheel = WheelNotches(step: 40)
		#expect(wheel.add(30) == 0)
		#expect(wheel.add(30) == 1, "30 + 30 passes one step, 20 carried")
		#expect(wheel.add(-60) == -1)
		wheel.reset()
		#expect(wheel.add(39) == 0)
	}

	@Test func pressesShortcutsWithTheModifiersAroundTheKey() {
		#expect(RemoteKeys.press("KeyC", modifiers: [.meta]) == [
			.key(code: "MetaLeft", action: .down, modifiers: []),
			.key(code: "KeyC", action: .down, modifiers: [.meta]),
			.key(code: "KeyC", action: .up, modifiers: [.meta]),
			.key(code: "MetaLeft", action: .up, modifiers: []),
		])
		let combo = RemoteKeys.press("Tab", modifiers: [.shift, .meta])
		#expect(combo.first == .key(code: "MetaLeft", action: .down, modifiers: []), "held in a fixed order")
		#expect(combo.last == .key(code: "MetaLeft", action: .up, modifiers: []), "and let go in reverse")
	}

	@Test func typesKeyByKeyOnlyWhileAModifierIsHeld() {
		#expect(RemoteKeys.typing("hi", modifiers: []) == [.text("hi")])
		#expect(RemoteKeys.typing("c", modifiers: [.meta]) == RemoteKeys.press("KeyC", modifiers: [.meta]))
		#expect(RemoteKeys.typing("T", modifiers: [.control]) == RemoteKeys.press("KeyT", modifiers: [.control, .shift]), "a capital adds Shift")
		#expect(RemoteKeys.typing("中", modifiers: [.meta]) == [.text("中")], "no key for it: typed as text")
	}

	@Test func mapsHardwareKeysToKeysTheDesktopCanPress() {
		#expect(RemoteKeys.code(forHIDUsage: 0x04) == "KeyA")
		#expect(RemoteKeys.code(forHIDUsage: 0x1D) == "KeyZ")
		#expect(RemoteKeys.code(forHIDUsage: 0x1E) == "Digit1")
		#expect(RemoteKeys.code(forHIDUsage: 0x27) == "Digit0")
		#expect(RemoteKeys.code(forHIDUsage: 0x29) == "Escape")
		#expect(RemoteKeys.code(forHIDUsage: 0x52) == "ArrowUp")
		#expect(RemoteKeys.code(forHIDUsage: 0xE7) == "MetaLeft", "the right-hand modifiers press the left-hand ones")
		#expect(RemoteKeys.code(forHIDUsage: 0x2D) == nil, "punctuation goes as typed text")
		#expect(RemoteKeys.isControlKey("Escape"))
		#expect(!RemoteKeys.isControlKey("KeyA"))
		#expect(!RemoteKeys.isControlKey("Space"))
	}

	@Test func armsAModifierForOneKeyAndLocksItOnADoubleTap() {
		var latch = ModifierLatch()
		latch.tap(.meta, at: 0)
		#expect(latch.state(.meta) == .once)
		#expect(latch.held == [.meta])
		latch.consume()
		#expect(latch.state(.meta) == .off, "gone after one key")

		latch.tap(.shift, at: 1_000)
		latch.tap(.shift, at: 1_200)
		#expect(latch.state(.shift) == .locked)
		latch.consume()
		#expect(latch.state(.shift) == .locked, "a locked one stays")
		latch.tap(.shift, at: 5_000)
		#expect(latch.state(.shift) == .off)

		latch.tap(.alt, at: 10_000)
		latch.tap(.alt, at: 11_000)
		#expect(latch.state(.alt) == .off, "a slow second tap turns it off")
	}

	@Test func movesTheCursorFromWhereItIsLikeATrackpad() {
		var pad = RemoteTrackpad()
		#expect(pad.cursor == (0.5, 0.5), "starts in the middle")
		// Slow: the cursor goes as far as the finger across the picture.
		#expect(pad.move(dx: 40, dy: -20, speed: 100, width: 400, height: 200) == .pointerMove(x: 0.6, y: 0.4))
		// Fast: further than the finger.
		_ = pad.move(dx: 40, dy: 0, speed: 800, width: 400, height: 200)
		#expect(near(pad.cursor.x, 0.8))
		// Never past the edge.
		_ = pad.move(dx: 10_000, dy: 10_000, speed: 100, width: 400, height: 200)
		#expect(pad.cursor == (1, 1))
		#expect(pad.move(dx: 0, dy: 0, speed: 0, width: 400, height: 200) == nil)
	}

	@Test func clicksAndDragsWhereTheCursorIsNotWhereTheFingerIs() {
		var pad = RemoteTrackpad()
		_ = pad.move(dx: -100, dy: 0, speed: 0, width: 400, height: 200)
		#expect(pad.click(.right) == [
			.pointerMove(x: 0.25, y: 0.5),
			.pointerButton(x: 0.25, y: 0.5, button: .right, action: .down),
			.pointerButton(x: 0.25, y: 0.5, button: .right, action: .up),
		])
		#expect(pad.press(.down) == .pointerButton(x: 0.25, y: 0.5, button: .left, action: .down))
	}

	@Test func finerControlOnAZoomedPicture() {
		var plain = RemoteTrackpad()
		var zoomed = RemoteTrackpad()
		_ = plain.move(dx: 40, dy: 0, speed: 0, width: 400, height: 200)
		_ = zoomed.move(dx: 40, dy: 0, speed: 0, width: 1_600, height: 800)
		#expect(near(zoomed.cursor.x - 0.5, (plain.cursor.x - 0.5) / 4))
	}
}
