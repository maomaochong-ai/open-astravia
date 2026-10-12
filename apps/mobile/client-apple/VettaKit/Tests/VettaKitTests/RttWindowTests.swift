import Testing
@testable import VettaKit

@Suite struct RttWindowTests {
	@Test func showsTheMedianOfTheLastFiveSoOneHiccupDoesNotJump() {
		var window = RttWindow()
		#expect(window.add(40) == 40)
		for ms in [42.0, 38, 41] { _ = window.add(ms) }
		#expect(window.add(900) == 41, "one slow sample leaves the figure where it was")
	}

	@Test func followsALastingChangeOnceItIsMostOfTheWindow() {
		var window = RttWindow()
		for _ in 0..<5 { _ = window.add(40) }
		_ = window.add(300)
		_ = window.add(300)
		#expect(window.add(300) == 300, "three of five slow samples move it")
	}

	@Test func startsOverWhenCleared() {
		var window = RttWindow()
		for _ in 0..<3 { _ = window.add(300) }
		window.clear()
		#expect(window.add(20) == 20)
	}
}
