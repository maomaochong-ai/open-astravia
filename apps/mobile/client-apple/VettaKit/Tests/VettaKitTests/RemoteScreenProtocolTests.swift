import Foundation
import Testing
@testable import VettaKit

@Suite struct RemoteScreenProtocolTests {
	@Test func speaksTheScreenSubscriptionLikeTheDesktop() {
		#expect(RemoteRequestMethod(rawValue: "screen.subscribe") == .screenSubscribe)
		#expect(RemoteEventName(rawValue: "screen.status") == .screenStatus)
	}

	@Test func readsWhetherTheDesktopCapturesOnDemandAndMayBeControlled() {
		let base: [String: JSONValue] = ["deviceName": .string("Mac"), "lanEndpoints": .array([]), "relayEnabled": .bool(true), "runningSessionCount": .number(0)]
		let old = RemoteAPI.readDeviceStatus(.object(base))
		#expect(old?.screen == false, "an older desktop streams whenever P2P is up")
		#expect(old?.desktopControl == nil)
		var current = base
		current["screen"] = .bool(true)
		current["desktopControl"] = .bool(false)
		let status = RemoteAPI.readDeviceStatus(.object(current))
		#expect(status?.screen == true)
		#expect(status?.desktopControl == false)
	}

	@Test func readsThePointerShapeAndKeepsItsHotSpotInside() {
		let png = Data([0x89, 0x50, 0x4E, 0x47])
		let cursor = RemoteAPI.readScreenCursor(.object([
			"image": .string(png.base64EncodedString()), "width": 28, "height": 40, "hotspotX": 5, "hotspotY": 99, "screenWidth": 1512,
		]))
		#expect(cursor == RemoteScreenCursor(image: png, width: 28, height: 40, hotspotX: 5, hotspotY: 40, screenWidth: 1512))
		#expect(RemoteAPI.readScreenCursor(.object(["image": "not base64!", "width": 28, "height": 40, "screenWidth": 1512])) == nil)
		#expect(RemoteEventName(rawValue: "screen.cursor") == .screenCursor)
	}

	@Test func showsThePointerReadableButNeverHuge() {
		let cursor = RemoteScreenCursor(image: Data([1]), width: 28, height: 40, hotspotX: 5, hotspotY: 5, screenWidth: 1512)
		#expect(abs(cursor.scale(shownWidth: 390) * 40 - 18) < 0.001, "a phone-wide picture would make it tiny")
		#expect(abs(cursor.scale(shownWidth: 900) * 40 - 900 * 40 / 1512) < 0.001, "in between it keeps its size on the picture")
		#expect(abs(cursor.scale(shownWidth: 4_000) * 40 - 30) < 0.001, "zoomed far in it stops growing")
	}

	@Test func readsWhyTheScreenOrInputIsUnavailable() {
		#expect(RemoteAPI.readScreenStatus(.object(["screen": .string("permission_denied"), "input": .string("ready")]))
			== RemoteScreenStatus(screen: .permissionDenied, input: .ready))
		#expect(RemoteAPI.readScreenStatus(.object(["screen": .string("hdr"), "input": .string("gamepad")]))
			== RemoteScreenStatus(screen: .unavailable, input: .unsupported), "states from a newer desktop degrade")
		#expect(RemoteAPI.readScreenStatus(.object(["screen": .string("streaming")])) == nil)
	}

	@Test func namesEveryWayThePhoneReachesTheComputer() {
		L10n.pin(language: "zh-Hans")
		defer { L10n.pin(language: nil) }
		#expect(LinkChannel.p2p.label == "直连")
		#expect(Set([LinkChannel.p2p, .lan, .relay].map(\.label)).count == 3)
	}
}
