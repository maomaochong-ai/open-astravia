import Foundation
import Testing
@testable import VettaKit

@Suite struct LinkIndicatorTests {
	private func link(_ status: LinkStatus, peerOnline: Bool = false, attempt: Int = 0, error: String? = nil) -> LinkSnapshot {
		var snapshot = LinkSnapshot.offline
		snapshot.status = status
		snapshot.peerOnline = peerOnline
		snapshot.reconnectAttempt = attempt
		snapshot.lastError = error
		return snapshot
	}

	@Test func followsTheLinkThroughAReconnect() {
		#expect(LinkIndicator(.offline) == .connecting, "before the first attempt nothing has failed yet")
		#expect(LinkIndicator(link(.connecting)) == .connecting)
		#expect(LinkIndicator(link(.online, peerOnline: true)) == .online)
		#expect(LinkIndicator(link(.offline, attempt: 1, error: "closed")) == .offline)
		#expect(LinkIndicator(link(.connecting, attempt: 1, error: "closed")) == .reconnecting(attempt: 1))
		#expect(LinkIndicator(link(.online, peerOnline: true)) == .online)
	}

	@Test func treatsARelayWithoutTheDesktopAsOffline() {
		#expect(LinkIndicator(link(.online, peerOnline: false)) == .offline)
	}
}
