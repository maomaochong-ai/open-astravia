import Testing
@testable import VettaKit

@Suite struct SignalingRetryTests {
	@Test func endsASessionThatHasNotConnectedDirectlyYet() {
		var retry = SignalingRetry()
		#expect(retry.dropped(directlyConnected: false) == .stop)
	}

	@Test func keepsADirectLinkAndBacksOffUntilSignalingIsBack() {
		var retry = SignalingRetry()
		let delays = (0..<7).map { _ in retry.dropped(directlyConnected: true) }
		#expect(delays == [1, 2, 4, 8, 16, 30, 30].map { .reconnect(after: $0) })

		retry.reopened()
		#expect(retry.dropped(directlyConnected: true) == .reconnect(after: 1))
	}
}
