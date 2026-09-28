import Foundation
import Testing
@testable import VettaKit

@Suite(.serialized) struct RemoteStreamStatsTests {
	@Test func tellsWhichWayThePictureTravels() {
		#expect(RemoteStreamStats.route(local: "host", remote: "host") == .lan)
		#expect(RemoteStreamStats.route(local: "srflx", remote: "host") == .internet)
		#expect(RemoteStreamStats.route(local: "prflx", remote: "srflx") == .internet)
		#expect(RemoteStreamStats.route(local: "host", remote: "relay") == .relayed)
		#expect(RemoteStreamStats.route(local: nil, remote: "host") == nil)
	}

	@Test func estimatesHowOldThePictureIsWhenShown() {
		let stats = RemoteStreamStats(roundTripMs: 10, jitterBufferMs: 30, decodeMs: 4)
		#expect(stats.pictureDelayMs == 39)
		#expect(RemoteStreamStats(jitterBufferMs: 30).pictureDelayMs == nil, "no round trip yet: no estimate")
	}

	@Test func summarisesInOneLine() {
		L10n.pin(language: "zh-Hans")
		defer { L10n.pin(language: nil) }
		let stats = RemoteStreamStats(route: .lan, roundTripMs: 7.6, framesPerSecond: 59.8, frameWidth: 2560, frameHeight: 1600, jitterBufferMs: 30, decodeMs: 4)
		#expect(stats.summary == "局域网直连 · 延迟 8 ms · 画面约 38 ms · 60 fps · 2560×1600")
		#expect(RemoteStreamStats().summary.isEmpty)
	}
}
