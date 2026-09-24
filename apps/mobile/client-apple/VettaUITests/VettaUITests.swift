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

	/// A brand-new phone paired with the harness desktop, on Work with its sessions listed.
	@MainActor private func launchPaired(_ extra: [String] = []) throws -> XCUIApplication {
		let invite = try XCTUnwrap(invite, "run through scripts/ui-test.sh to provide a desktop")
		let app = XCUIApplication()
		app.launchArguments = ["-VettaEphemeralStorage", "-VettaPairURI", invite, "-VettaUITestAttachments"] + extra + chinese
		app.launch()
		if !app.buttons["session.s-report"].waitForExistence(timeout: 15) {
			shot(app, "fail-home")
			XCTFail("Work should list the desktop's sessions")
		}
		return app
	}

	@MainActor func testWorkListFiltersAndCollapsesItsTitle() throws {
		let app = try launchPaired()
		XCTAssertTrue(app.buttons["session.s-build"].exists)
		XCTAssertTrue(app.buttons["session.s-docs"].exists)
		XCTAssertFalse(app.buttons["link.status.compact"].exists, "the small title waits until the large one scrolls away")
		// Pull to refresh at the top: the refresh control grows the inset for a moment, which must not collapse the title.
		app.buttons["session.s-report"].swipeDown(velocity: .fast)
		sleep(2)
		XCTAssertFalse(app.buttons["link.status.compact"].exists, "back at the top after a refresh, only the large title shows")
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

		// Scrolling the large title away hands over to the small one with the link icon.
		app.swipeUp()
		XCTAssertTrue(app.buttons["link.status.compact"].waitForExistence(timeout: 5))
		shot(app, "9-collapsed")
	}

	@MainActor func testChatMergesRepliesAndSwitchesModel() throws {
		let app = try launchPaired()
		app.buttons["session.s-report"].tap()
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

		// The title switches the model, then the thinking levels that model offers.
		let modelMenu = app.buttons["chat.modelMenu"]
		XCTAssertTrue(modelMenu.waitForExistence(timeout: 5))
		XCTAssertTrue(waitForLabel(modelMenu, containing: "Claude Opus 5 · 中"), "starts on the desktop's current model: \(modelMenu.label)")
		pick(app, "chat.modelMenu", "GLM 5")
		XCTAssertTrue(waitForLabel(modelMenu, containing: "GLM 5"))
		pick(app, "chat.modelMenu", "最高")
		XCTAssertTrue(waitForLabel(modelMenu, containing: "GLM 5 · 最高"))
		shot(app, "5b-model")
	}

	@MainActor func testFailedTurnShowsOneErrorLine() throws {
		let app = try launchPaired()
		app.buttons["session.s-docs"].tap()
		let modelMenu = app.buttons["chat.modelMenu"]
		XCTAssertTrue(waitForLabel(modelMenu, containing: "Claude Opus 5 · 中"))
		// A turn that fails: waiting feedback right away, then one error line that counts the retry.
		let field = composerField(app)
		XCTAssertTrue(field.waitForExistence(timeout: 5))
		field.tap()
		field.typeText("模拟报错")
		app.buttons["composer.send"].tap()
		let status = app.descendants(matching: .any)["turn.status"]
		XCTAssertTrue(status.waitForExistence(timeout: 3), "a sent message shows the turn working at once")
		XCTAssertEqual(status.label, "等待模型响应")
		let failure = app.descendants(matching: .any)["turn.error"]
		XCTAssertTrue(failure.waitForExistence(timeout: 10), "the failure shows without reopening the chat")
		XCTAssertTrue(waitForLabel(failure, containing: "Connection error."), failure.label)
		XCTAssertTrue(waitForLabel(failure, containing: "×2"), "the retry that fails the same way adds to the count: \(failure.label)")
		XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "turn.error").count, 1, "retries merge into one line")
		XCTAssertTrue(waitForLabel(modelMenu, containing: "Claude Opus 5 · 中"), "a failed turn keeps showing the model: \(modelMenu.label)")
		shot(app, "5c-error")
		// Tapping the conversation puts the keyboard away.
		XCTAssertTrue(app.keyboards.firstMatch.exists)
		app.staticTexts["模拟报错"].tap()
		XCTAssertTrue(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)], timeout: 3) == .completed, "tapping outside the composer hides the keyboard")
	}

	@MainActor func testNewSessionWithAttachmentsAnswersAQuestion() throws {
		let app = try launchPaired()
		// New Session: start in a project and land straight in its chat.
		app.buttons["work.newSession"].tap()
		XCTAssertTrue(app.staticTexts["让我们开始吧"].waitForExistence(timeout: 5))
		XCTAssertTrue(app.staticTexts["我可以帮你处理工作，有什么可以帮助你的？"].exists)
		XCTAssertFalse(app.tabBars.buttons["工作"].isHittable, "New Session hides the tab bar like a chat")
		pick(app, "newSession.model", "GLM 5")
		pick(app, "newSession.location", "vetta")
		// The attach button opens a sheet: Photos and Camera lead the strip, Files is the list below.
		app.buttons["composer.attach"].tap()
		let photos = app.buttons["attach.photos"]
		XCTAssertTrue(photos.waitForExistence(timeout: 5))
		XCTAssertTrue(app.buttons["attach.camera"].exists)
		XCTAssertTrue(app.buttons["attach.files"].exists)
		XCTAssertTrue(app.buttons["attach.recent"].waitForExistence(timeout: 5), "recent photos follow Camera in the strip")
		XCTAssertLessThan(photos.frame.maxY, app.buttons["attach.files"].frame.minY, "the strip sits above the list")
		shot(app, "6a-attach")
		settledTap(app.buttons["attach.camera"])
		XCTAssertTrue(app.descendants(matching: .any)["attach.notice"].waitForExistence(timeout: 5), "the simulator has no camera")
		settledTap(app.buttons["composer.attach.sample"])
		XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "composer.attachment").firstMatch.waitForExistence(timeout: 5))
		XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "composer.attachment").count, 2)
		// Send appears once there is text; Return adds a line instead of sending.
		XCTAssertFalse(app.buttons["composer.send"].exists, "nothing to send yet")
		let field = composerField(app)
		XCTAssertTrue(field.waitForExistence(timeout: 5))
		field.tap()
		field.typeText("帮我检查一下构建\n顺便看看附件")
		XCTAssertTrue(app.buttons["composer.send"].waitForExistence(timeout: 3), "Return adds a line instead of sending")
		shot(app, "6-new-session")
		app.buttons["composer.send"].tap()

		let option = app.buttons["question.option.继续"]
		XCTAssertTrue(option.waitForExistence(timeout: 15), "the desktop's question should reach the phone")
		XCTAssertTrue(app.descendants(matching: .any)["bubble.attachments"].exists, "the bubble lists what was attached")
		XCTAssertTrue(
			app.staticTexts.containing(NSPredicate(format: "label CONTAINS '附件：photo-sample.jpg'")).firstMatch.waitForExistence(timeout: 5),
			"the desktop received both uploads with the prompt"
		)
		XCTAssertTrue(app.buttons["chat.modelMenu"].label.contains("GLM 5"), "the session started on the chosen model")
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
		XCTAssertFalse(composerField(app).exists, "the question takes the composer's place")
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
		XCTAssertTrue(composerField(app).waitForExistence(timeout: 5), "the composer comes back once answered")
	}

	@MainActor func testHoldingTheEmptyFieldDictatesIntoIt() throws {
		let app = try launchPaired(["-VettaUITestDictation", "帮我看看构建"])
		// An idle session: while one is running the field's button is Stop, not Send.
		app.buttons["session.s-docs"].tap()
		let field = composerField(app)
		XCTAssertTrue(field.waitForExistence(timeout: 10))
		XCTAssertEqual(field.placeholderValue, "指示 Vetta 或按住说话…")
		let attach = app.buttons["composer.attach"].frame
		let box = app.descendants(matching: .any)["composer.box"].frame
		XCTAssertEqual(attach.height, box.height, accuracy: 0.5, "the attach button and a one-line field are the same height")
		XCTAssertEqual(attach.midY, box.midY, accuracy: 0.5)
		// Hold, slide up, let go: nothing is kept.
		let start = field.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
		start.press(forDuration: 1.2, thenDragTo: start.withOffset(CGVector(dx: 0, dy: -160)))
		sleep(1)
		XCTAssertFalse(app.buttons["composer.send"].exists, "sliding up cancels the dictation")
		// Hold and let go: the words land in the field, unsent.
		field.press(forDuration: 1.5)
		XCTAssertTrue(app.buttons["composer.send"].waitForExistence(timeout: 3), "the dictated words fill the field")
		XCTAssertEqual(field.value as? String, "帮我看看构建")
		XCTAssertFalse(app.staticTexts["帮我看看构建"].exists, "dictation never sends by itself")
		shot(app, "5d-dictated")
		// A tap on the empty field still starts typing.
		field.tap()
		XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3))
	}

	@MainActor func testSettingsShowsTheComputerAndUnpairs() throws {
		let app = try launchPaired()
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

	/// The multi-line composer shows up as a text view or a text field depending on the OS.
	@MainActor private func composerField(_ app: XCUIApplication) -> XCUIElement {
		app.descendants(matching: .any).matching(identifier: "composer.field").firstMatch
	}

	@MainActor private func waitForLabel(_ element: XCUIElement, containing text: String) -> Bool {
		let predicate = NSPredicate(format: "label CONTAINS %@", text)
		return XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: element)], timeout: 5) == .completed
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
		// A tap while the menu is still opening only highlights the item.
		Thread.sleep(forTimeInterval: 0.8)
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
