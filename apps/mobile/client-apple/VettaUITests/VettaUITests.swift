import XCTest

/// Drives the real app. The end-to-end flow needs the interop harness
/// (`scripts/ui-test.sh` starts it and passes the invite through the
/// `VETTA_UITEST_INVITE` environment variable); without it only the first-run
/// pairing guide and scanner are checked. The app is pinned to Simplified Chinese because
/// the assertions read its copy; it otherwise follows the system language.
final class VettaUITests: XCTestCase {
	private var shotDirectory: String? { ProcessInfo.processInfo.environment["VETTA_UITEST_SHOTS"].flatMap { $0.isEmpty ? nil : $0 } }
	private var invite: String? { ProcessInfo.processInfo.environment["VETTA_UITEST_INVITE"] }
	private var appearance: String { ProcessInfo.processInfo.environment["VETTA_UITEST_APPEARANCE"] ?? "dark" }

	private let chinese = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]

	override func setUp() {
		continueAfterFailure = false
	}

	@MainActor func testGuidesToPairingOnFirstLaunch() {
		let app = XCUIApplication()
		app.launchArguments = ["-VettaEphemeralStorage"] + chinese
		app.launch()
		let pair = app.buttons["home.pair"]
		XCTAssertTrue(pair.waitForExistence(timeout: 10), "an unpaired Work tab should guide to pairing")
		XCTAssertTrue(app.staticTexts["还没有连接电脑"].exists)
		XCTAssertFalse(app.buttons["filter.status"].exists, "an unpaired Work tab shows nothing but the guide")
		shot(app, "0-guide")

		pair.tap()
		XCTAssertTrue(app.staticTexts["对准电脑端的二维码"].waitForExistence(timeout: 10))
		app.buttons["pair.close"].tap()
		XCTAssertTrue(pair.waitForExistence(timeout: 5), "closing the scanner returns to the guide")

		app.tabBars.buttons["设置"].tap()
		let scan = app.buttons["settings.scan"]
		XCTAssertTrue(scan.waitForExistence(timeout: 5), "Settings offers a scan while unpaired")
		XCTAssertFalse(app.buttons["settings.unpair"].exists)
		scan.tap()
		XCTAssertTrue(app.staticTexts["对准电脑端的二维码"].waitForExistence(timeout: 10))
		app.buttons["pair.close"].tap()
		app.tabBars.buttons["工作"].tap()

		app.buttons["home.pair"].tap()
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
		app.launchArguments = ["-VettaEphemeralStorage", "-VettaPairURI", invite] + chinese
		app.launch()

		let report = app.buttons["session.s-report"]
		if !report.waitForExistence(timeout: 15) {
			shot(app, "fail-home")
			XCTFail("Work should list the desktop's sessions")
		}
		XCTAssertTrue(app.buttons["session.s-build"].exists)
		XCTAssertTrue(app.buttons["session.s-docs"].exists)
		XCTAssertFalse(app.buttons["link.status.compact"].exists, "the small title waits until the large one scrolls away")
		shot(app, "3-home")

		// Status filter: only the running session is in progress.
		pick(app, "filter.status", "处理中")
		XCTAssertTrue(app.buttons["session.s-build"].waitForExistence(timeout: 5))
		XCTAssertFalse(app.buttons["session.s-report"].exists)
		pick(app, "filter.status", "所有")
		// Kind filter: choosing projects opens a third chip for one project.
		XCTAssertFalse(app.buttons["filter.project"].exists)
		pick(app, "filter.kind", "项目")
		XCTAssertTrue(app.buttons["filter.project"].waitForExistence(timeout: 5))
		XCTAssertFalse(app.buttons["session.s-report"].exists, "conversations are not projects")
		pick(app, "filter.project", "docs")
		XCTAssertTrue(app.buttons["session.s-docs"].waitForExistence(timeout: 5))
		XCTAssertFalse(app.buttons["session.s-build"].exists)
		shot(app, "4-filtered")
		pick(app, "filter.kind", "所有类型")
		XCTAssertFalse(app.buttons["filter.project"].waitForExistence(timeout: 2), "leaving projects drops the project chip")
		XCTAssertTrue(app.buttons["session.s-report"].waitForExistence(timeout: 5))

		report.tap()
		// Two replies in a row are one turn; their tool calls fold into one step group.
		XCTAssertTrue(app.descendants(matching: .any)["turn.a1"].waitForExistence(timeout: 10))
		XCTAssertFalse(app.descendants(matching: .any)["turn.a1b"].exists, "the second reply merges into the first turn")
		// Text between tool rounds closes a step group: thinking + web_search, then write_file.
		let groups = app.buttons.matching(identifier: "turn.work")
		XCTAssertEqual(groups.allElementsBoundByIndex.map(\.label), ["完成了 2 步操作", "完成了 1 步操作"])
		settledTap(groups.firstMatch)
		XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'web_search'")).firstMatch.waitForExistence(timeout: 5))
		XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'write_file'")).firstMatch.exists, "the second group stays folded")
		XCTAssertFalse(app.tabBars.buttons["工作"].isHittable, "the chat page hides the tab bar")
		shot(app, "5-history")
		app.navigationBars.buttons.element(boundBy: 0).tap()

		// New Session: start in a project and land straight in its chat.
		app.buttons["work.newSession"].tap()
		XCTAssertTrue(app.staticTexts["想让电脑做点什么？"].waitForExistence(timeout: 5))
		XCTAssertFalse(app.tabBars.buttons["工作"].isHittable, "New Session hides the tab bar like a chat")
		pick(app, "newSession.location", "vetta")
		let field = app.textFields["composer.field"]
		XCTAssertTrue(field.waitForExistence(timeout: 5))
		field.tap()
		field.typeText("帮我检查一下构建")
		shot(app, "6-new-session")
		app.buttons["composer.send"].tap()

		let option = app.buttons["question.option.继续"]
		XCTAssertTrue(option.waitForExistence(timeout: 15), "the desktop's question should reach the phone")
		shot(app, "7-question")

		// Back lands on Work, where the session waiting on us sits on top.
		app.navigationBars.buttons.element(boundBy: 0).tap()
		let first = app.cells.element(boundBy: 1)
		XCTAssertTrue(first.waitForExistence(timeout: 5))
		XCTAssertTrue(first.staticTexts["待你决策"].exists, "a session waiting on the user is pinned to the top")
		XCTAssertTrue(first.staticTexts["vetta"].exists, "it was started in the chosen project")
		shot(app, "8-waiting")
		first.tap()
		// The question replaces the composer: answer two questions, the second with Other.
		XCTAssertTrue(option.waitForExistence(timeout: 10))
		XCTAssertFalse(app.textFields["composer.field"].exists, "the question takes the composer's place")
		XCTAssertFalse(app.buttons["question.next"].isEnabled, "Next waits for an answer")
		option.tap()
		app.buttons["question.next"].tap()
		XCTAssertTrue(app.buttons["question.option.测试"].waitForExistence(timeout: 5))
		XCTAssertFalse(app.buttons["question.submit"].isEnabled)
		app.buttons["question.option.测试"].tap()
		app.buttons["question.other"].tap()
		let other = app.textFields["question.otherField"]
		XCTAssertTrue(other.waitForExistence(timeout: 5))
		other.typeText("设计")
		shot(app, "8b-question-panel")
		app.buttons["question.submit"].tap()
		XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS '你的选择：继续；测试、设计'")).firstMatch.waitForExistence(timeout: 10))
		XCTAssertTrue(app.textFields["composer.field"].waitForExistence(timeout: 5), "the composer comes back once answered")
		app.navigationBars.buttons.element(boundBy: 0).tap()

		// Scrolling the large title away hands over to the small one with the link icon.
		app.swipeDown()
		app.swipeUp()
		XCTAssertTrue(app.buttons["link.status.compact"].waitForExistence(timeout: 5))
		shot(app, "9-collapsed")
		app.swipeDown()

		app.tabBars.buttons["设置"].tap()
		let computer = app.descendants(matching: .any)["settings.computer"]
		XCTAssertTrue(computer.waitForExistence(timeout: 5))
		XCTAssertTrue(computer.label.contains("Interop MacBook Pro"), "Settings names the paired computer")
		XCTAssertTrue(app.buttons["settings.rescan"].exists, "rescanning lives in Settings now")
		shot(app, "10-settings")

		app.buttons["settings.unpair"].tap()
		app.alerts.buttons["解除配对"].tap()
		XCTAssertTrue(app.buttons["settings.scan"].waitForExistence(timeout: 5), "after unpairing Settings offers a fresh scan")
		app.tabBars.buttons["工作"].tap()
		XCTAssertTrue(app.buttons["home.pair"].waitForExistence(timeout: 5), "Work falls back to the pairing guide")
	}

	/// Taps once the element stops moving, e.g. after a chat scrolls to its latest line.
	@MainActor private func settledTap(_ element: XCUIElement) {
		XCTAssertTrue(element.waitForExistence(timeout: 5))
		var frame = element.frame
		for _ in 0 ..< 20 {
			Thread.sleep(forTimeInterval: 0.15)
			if element.frame == frame { break }
			frame = element.frame
		}
		element.tap()
	}

	/// Opens a menu chip and chooses the option whose label starts with `option`.
	@MainActor private func pick(_ app: XCUIApplication, _ menu: String, _ option: String) {
		let chip = app.buttons[menu]
		XCTAssertTrue(chip.waitForExistence(timeout: 5), "\(menu) should be on screen")
		chip.tap()
		let item = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", option)).firstMatch
		XCTAssertTrue(item.waitForExistence(timeout: 5), "\(menu) should offer \(option)")
		item.tap()
	}

	/// Screenshots are for reviewing the design; only runs that save them wait for animations to settle.
	@MainActor private func shot(_ app: XCUIApplication, _ name: String) {
		guard let directory = shotDirectory else { return }
		Thread.sleep(forTimeInterval: 0.6)
		let screenshot = app.screenshot()
		let attachment = XCTAttachment(screenshot: screenshot)
		attachment.name = name
		attachment.lifetime = .keepAlways
		add(attachment)
		try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: directory).appendingPathComponent("\(appearance)-\(name).png"))
	}
}
