import XCTest

/// Drives the real app. The end-to-end flow needs the interop harness
/// (`scripts/ui-test.sh` starts it and passes the invite through the
/// `VETTA_UITEST_INVITE` environment variable); without it only the first-run
/// pairing screen is checked.
final class VettaUITests: XCTestCase {
	private var shotDirectory: String? { ProcessInfo.processInfo.environment["VETTA_UITEST_SHOTS"] }
	private var invite: String? { ProcessInfo.processInfo.environment["VETTA_UITEST_INVITE"] }
	private var appearance: String { ProcessInfo.processInfo.environment["VETTA_UITEST_APPEARANCE"] ?? "dark" }

	override func setUp() {
		continueAfterFailure = false
	}

	@MainActor func testShowsThePairingScreenOnFirstLaunch() {
		let app = XCUIApplication()
		app.launchArguments = ["-VettaEphemeralStorage"]
		app.launch()
		XCTAssertTrue(app.staticTexts["对准电脑端的二维码"].waitForExistence(timeout: 10))
		XCTAssertTrue(app.buttons["pair.manual"].exists)
		shot(app, "1-pair")
		app.buttons["pair.manual"].tap()
		XCTAssertTrue(app.textFields["pair.endpoint"].waitForExistence(timeout: 5))
		app.textFields["pair.endpoint"].typeText("not an address\n")
		XCTAssertTrue(app.staticTexts["请输入形如 192.168.1.20:43117 的地址"].waitForExistence(timeout: 5))
		shot(app, "2-manual")
	}

	@MainActor func testMirrorsADesktopSessionEndToEnd() throws {
		let invite = try XCTUnwrap(invite, "run through scripts/ui-test.sh to provide a desktop")
		let app = XCUIApplication()
		app.launchArguments = ["-VettaEphemeralStorage", "-VettaPairURI", invite]
		app.launch()

		let history = app.buttons["session.s-report"]
		if !history.waitForExistence(timeout: 15) {
			shot(app, "fail-home")
			XCTFail("home should list the desktop's sessions")
		}
		XCTAssertTrue(app.staticTexts["电脑正在做的事"].exists)
		sleep(1)
		shot(app, "3-home")

		history.tap()
		XCTAssertTrue(app.staticTexts["web_search: jira week 38"].waitForExistence(timeout: 10) || app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'web_search'")).firstMatch.waitForExistence(timeout: 5))
		sleep(1)
		shot(app, "4-history")
		app.navigationBars.buttons.element(boundBy: 0).tap()

		let field = app.textFields["composer.field"]
		XCTAssertTrue(field.waitForExistence(timeout: 5))
		field.tap()
		field.typeText("帮我检查一下构建")
		app.buttons["composer.send"].tap()

		let option = app.buttons["question.option.继续"]
		XCTAssertTrue(option.waitForExistence(timeout: 15), "the desktop's question should reach the phone")
		sleep(1)
		shot(app, "5-question")
		option.tap()
		app.buttons["question.submit"].tap()
		XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS '已按你的选择继续'")).firstMatch.waitForExistence(timeout: 10))
		sleep(1)
		shot(app, "6-answered")

		app.navigationBars.buttons.element(boundBy: 0).tap()
		app.buttons["home.settings"].tap()
		XCTAssertTrue(app.staticTexts["连接与偏好"].waitForExistence(timeout: 5))
		sleep(1)
		shot(app, "7-settings")
	}

	@MainActor private func shot(_ app: XCUIApplication, _ name: String) {
		let screenshot = app.screenshot()
		let attachment = XCTAttachment(screenshot: screenshot)
		attachment.name = name
		attachment.lifetime = .keepAlways
		add(attachment)
		if let directory = shotDirectory {
			try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: directory).appendingPathComponent("\(appearance)-\(name).png"))
		}
	}
}
