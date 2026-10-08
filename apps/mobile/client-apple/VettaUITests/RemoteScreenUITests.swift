import UIKit
import XCTest

final class RemoteScreenUITests: XCTestCase {
	override func setUp() { continueAfterFailure = false }

	@MainActor func testVideoUpdatesReceivesInputAndResumesAfterReopening() throws {
		guard let invite = ProcessInfo.processInfo.environment["VETTA_SCREEN_INVITE"] else {
			throw XCTSkip("Run scripts/screen-test.sh for the synthetic WebRTC host")
		}
		let app = XCUIApplication()
		app.launchArguments = ["-VettaEphemeralStorage", "-VettaPairURI", invite, "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
		app.launch()
		openScreen(app)
		assertVideoChanges(app)
		// The fixture turns green only when an input arrives over the real DataChannel.
		app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
		XCTAssertTrue(waitForColors(app, [.green]), "a tap must reach the host and change the transmitted video")
		attach(app, name: "remote-input-received")
		app.buttons["remote.close"].tap()
		XCTAssertTrue(app.buttons["home.remote"].waitForExistence(timeout: 5))
		app.buttons["home.remote"].tap()
		assertVideoChanges(app)
		app.buttons["remote.close"].tap()
	}

	@MainActor private func openScreen(_ app: XCUIApplication) {
		XCTAssertTrue(app.buttons["drawer.open"].waitForExistence(timeout: 15))
		app.buttons["drawer.open"].tap()
		XCTAssertTrue(app.buttons["home.remote"].waitForExistence(timeout: 10))
		app.buttons["home.remote"].tap()
		XCTAssertTrue(app.buttons["remote.close"].waitForExistence(timeout: 10))
	}

	@MainActor private func assertVideoChanges(_ app: XCUIApplication) {
		XCTAssertTrue(waitForColors(app, [.red, .blue]), "video must display distinct frames, not a black or frozen surface")
		attach(app, name: "remote-video-updating")
	}

	private enum Color: Hashable { case red, blue, green }

	@MainActor private func waitForColors(_ app: XCUIApplication, _ expected: Set<Color>) -> Bool {
		var observed = Set<Color>()
		let predicate = NSPredicate { [self] _, _ in
			if let color = centerColor(app.screenshot().image) { observed.insert(color) }
			return expected.isSubset(of: observed)
		}
		return XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: nil)], timeout: 15) == .completed
	}

	/// Sample inside the letterboxed video, excluding the navigation bar, counters and controls.
	/// Two dominant colors prove visible, changing pixels; FPS alone also passes on the regression.
	private func centerColor(_ image: UIImage) -> Color? {
		guard let source = image.cgImage else { return nil }
		let area = CGRect(x: Double(source.width) * 0.3, y: Double(source.height) * 0.43,
			width: Double(source.width) * 0.4, height: Double(source.height) * 0.14)
		guard let cropped = source.cropping(to: area) else { return nil }
		var bytes = [UInt8](repeating: 0, count: 16 * 16 * 4)
		let drawn = bytes.withUnsafeMutableBytes { pixels -> Bool in
			guard let context = CGContext(data: pixels.baseAddress, width: 16, height: 16, bitsPerComponent: 8,
				bytesPerRow: 16 * 4, space: CGColorSpaceCreateDeviceRGB(),
				bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
			context.draw(cropped, in: CGRect(x: 0, y: 0, width: 16, height: 16))
			return true
		}
		guard drawn else { return nil }
		var counts: [Color: Int] = [:]
		for offset in stride(from: 0, to: bytes.count, by: 4) {
			let r = bytes[offset], g = bytes[offset + 1], b = bytes[offset + 2]
			if r > 140 && g < 130 && b < 130 { counts[.red, default: 0] += 1 }
			if b > 140 && r < 110 && g < 180 { counts[.blue, default: 0] += 1 }
			if g > 130 && r < 110 && b < 130 { counts[.green, default: 0] += 1 }
		}
		return counts.first { $0.value > 140 }?.key
	}

	@MainActor private func attach(_ app: XCUIApplication, name: String) {
		let attachment = XCTAttachment(screenshot: app.screenshot())
		attachment.name = name
		attachment.lifetime = .keepAlways
		add(attachment)
	}
}
