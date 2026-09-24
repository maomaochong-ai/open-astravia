import Foundation
import Testing
@testable import VettaKit

@Suite struct HoldToTalkTests {
	@Test func aQuickTapStartsTyping() {
		var press = HoldToTalk()
		#expect(press.began(at: 0) == .none)
		#expect(press.moved(dx: 1, dy: 1, at: 0.08) == .none)
		#expect(press.ended(at: 0.12) == .focus)
		#expect(press.phase == .idle)
	}

	@Test func holdingListensAndReleasingInserts() {
		var press = HoldToTalk()
		_ = press.began(at: 0)
		#expect(press.moved(dx: 0, dy: 0, at: 0.14) == .none)
		#expect(press.moved(dx: 0, dy: 0, at: 0.15) == .startListening, "a timer tick while holding still starts dictation")
		#expect(press.moved(dx: 3, dy: -20, at: 1) == .none, "small drift while talking changes nothing")
		#expect(press.ended(at: 2) == .finish(insert: true))
	}

	@Test func slidingUpArmsCancelAndBackDownDisarmsIt() {
		var press = HoldToTalk()
		_ = press.began(at: 0)
		_ = press.moved(dx: 0, dy: 0, at: 0.4)
		#expect(press.moved(dx: 0, dy: -80, at: 1) == .cancelArmed(true))
		#expect(press.moved(dx: 0, dy: -90, at: 1.1) == .none)
		#expect(press.moved(dx: 0, dy: -10, at: 1.2) == .cancelArmed(false))
		_ = press.moved(dx: 0, dy: -100, at: 1.3)
		#expect(press.ended(at: 1.5) == .finish(insert: false))
	}

	@Test func movingAwayBeforeTheHoldIsNotAPress() {
		var press = HoldToTalk()
		_ = press.began(at: 0)
		#expect(press.moved(dx: 0, dy: 30, at: 0.1) == .none)
		#expect(press.moved(dx: 0, dy: 0, at: 0.5) == .none, "an abandoned touch never starts listening")
		#expect(press.ended(at: 0.6) == .none)
	}

	@Test func dictationJoinsWhatIsTyped() {
		var draft = PromptDraft()
		draft.insertDictation("  帮我看看构建 ")
		#expect(draft.text == "帮我看看构建")
		draft.insertDictation("顺便跑测试")
		#expect(draft.text == "帮我看看构建顺便跑测试", "Chinese needs no space")
		draft.text = "Run the build."
		draft.insertDictation("then tests")
		#expect(draft.text == "Run the build. then tests")
		draft.text = "第一行\n"
		draft.insertDictation("second")
		#expect(draft.text == "第一行\nsecond")
		draft.insertDictation("   ")
		#expect(draft.text == "第一行\nsecond")
	}
}
