import Testing
@testable import VettaKit

@Suite struct StreamRevealTests {
	@Test func revealsASmallDeltaAtTheSteadyRate() {
		var reveal = StreamReveal(shown: 0, at: 0)
		reveal.advance(to: 0.1, target: 10)
		// 45 characters a second, and 10 waiting is little: about 4 after 0.1s.
		#expect(reveal.shown == 4)
		reveal.advance(to: 1, target: 10)
		#expect(reveal.shown == 10)
	}

	@Test func catchesUpWithABurstWithinTheCatchUpTime() {
		var reveal = StreamReveal(shown: 0, at: 0)
		var time = 0.0
		while time < StreamReveal.catchUp * 3 {
			time += 1.0 / 60
			reveal.advance(to: time, target: 900)
		}
		// Exponential catch-up: well past 90% of a large burst within a few catch-up periods.
		#expect(reveal.shown > 850)
	}

	@Test func newCharactersFadeInAndSettle() {
		var reveal = StreamReveal(shown: 0, at: 0)
		reveal.advance(to: 0.05, target: 2)
		#expect(reveal.shown == 2)
		let fresh = reveal.opacity(at: 1)
		#expect(fresh > 0 && fresh < 1)
		#expect(reveal.opacity(at: 0) >= fresh)
		#expect(reveal.opacity(at: 2) == 0)
		#expect(reveal.animating(toward: 2))
		reveal.advance(to: 1, target: 2)
		#expect(reveal.opacity(at: 1) == 1)
		#expect(!reveal.animating(toward: 2))
	}

	@Test func textAlreadyOnScreenIsOpaque() {
		let reveal = StreamReveal(shown: 120, at: 5)
		#expect(reveal.opacity(at: 119) == 1)
		#expect(!reveal.animating(toward: 120))
	}

	@Test func aShorterRefetchIsShownAsItIs() {
		var reveal = StreamReveal(shown: 0, at: 0)
		reveal.advance(to: 0.5, target: 40)
		reveal.advance(to: 0.52, target: 5)
		#expect(reveal.shown == 5)
		reveal.advance(to: 2, target: 5)
		#expect(reveal.opacity(at: 4) == 1)
		#expect(!reveal.animating(toward: 5))
	}
}
