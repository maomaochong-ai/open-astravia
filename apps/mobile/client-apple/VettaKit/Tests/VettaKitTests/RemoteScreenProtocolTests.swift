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

	@Test func readsWhyTheScreenOrInputIsUnavailable() {
		#expect(RemoteAPI.readScreenStatus(.object(["screen": .string("permission_denied"), "input": .string("ready")]))
			== RemoteScreenStatus(screen: .permissionDenied, input: .ready))
		#expect(RemoteAPI.readScreenStatus(.object(["screen": .string("hdr"), "input": .string("gamepad")]))
			== RemoteScreenStatus(screen: .unavailable, input: .unsupported), "states from a newer desktop degrade")
		#expect(RemoteAPI.readScreenStatus(.object(["screen": .string("streaming")])) == nil)
	}
}
