import Foundation
import Testing
@testable import VettaKit

/// The remote desktop page against a scripted desktop (ADR-0140).
@Suite(.serialized) struct AppModelScreenTests {
	final class Subscriptions {
		var active: [Bool] = []
		var cursor: [Bool] = []
		var connection: RemoteConnection?
	}

	/// Returns the desktop too: its connections hold it weakly, so it must outlive the test's requests.
	private func pairedModel(capturesOnDemand: Bool, subscriptions: Subscriptions) async throws -> (AppModel, FakeDesktop) {
		let desktop = FakeDesktop()
		desktop.onHello = { _ in .approve }
		desktop.onRequest = { connection, request in
			subscriptions.connection = connection
			switch request.method {
			case .sessionList:
				var status: [String: JSONValue] = ["deviceName": "MacBook Pro", "lanEndpoints": [], "relayEnabled": false, "runningSessionCount": 0]
				if capturesOnDemand { status["screen"] = true }
				try? connection.respond(requestId: request.requestId, success: true, payload: ["sessions": []])
				_ = try? connection.emitEvent(.deviceStatus, payload: .object(status))
			case .screenSubscribe:
				let active = request.payload?["active"]?.boolValue == true
				subscriptions.active.append(active)
				subscriptions.cursor.append(request.payload?["cursor"]?.boolValue == true)
				try? connection.respond(requestId: request.requestId, success: true, payload: [
					"screen": .string(active ? "streaming" : "stopped"),
					"input": "permission_denied",
				])
			default:
				try? connection.respond(requestId: request.requestId, success: true, payload: [:])
			}
		}
		let model = AppModel(platform: .memory(createTransport: desktop.createTransport))
		model.start()
		let invite = PairingURI.build(RemotePairingInvite(pairingId: "pair-1234567890abcdef", mobileSecret: "secret-1234567890abcdef", desktopIdentityKey: desktop.identityKey, desktopName: "MacBook Pro", lanEndpoints: ["192.168.1.20:43117"], relayBaseUrl: "wss://relay.example"))
		#expect(await model.pairWithCode(invite))
		#expect(await eventually { model.link.desktop != nil })
		return (model, desktop)
	}

	@Test func subscribesOnlyWhileThePageIsOpenAndTheAppIsInFront() async throws {
		let subscriptions = Subscriptions()
		let (model, desktop) = try await pairedModel(capturesOnDemand: true, subscriptions: subscriptions)
		defer { withExtendedLifetime(desktop) {} }

		model.setScreenOpen(true)
		#expect(await eventually { model.screen == RemoteScreenStatus(screen: .streaming, input: .permissionDenied) })
		#expect(subscriptions.active == [true])

		#expect(subscriptions.cursor == [true], "the phone draws the pointer and wants its shape")
		_ = try subscriptions.connection?.emitEvent(.screenCursor, payload: ["image": "iVBORw==", "width": 28, "height": 40, "hotspotX": 5, "hotspotY": 5, "screenWidth": 1512])
		#expect(await eventually { model.screenCursor?.width == 28 })

		// The desktop follows up once Accessibility is granted.
		_ = try subscriptions.connection?.emitEvent(.screenStatus, payload: ["screen": "streaming", "input": "ready"])
		#expect(await eventually { model.screen?.input == .ready })

		model.setActive(false)
		#expect(await eventually { subscriptions.active == [true, false] }, "the background stops the capture")
		#expect(model.screen == nil)
		#expect(model.screenCursor == nil)
		model.setActive(true)
		#expect(await eventually { subscriptions.active.last == true && subscriptions.active.count == 3 })

		model.setScreenOpen(false)
		#expect(await eventually { subscriptions.active.count == 4 && subscriptions.active.last == false })
		#expect(model.screen == nil)
	}

	@Test func subscribesAgainWhenTheDesktopReconnects() async throws {
		let subscriptions = Subscriptions()
		let (model, desktop) = try await pairedModel(capturesOnDemand: true, subscriptions: subscriptions)
		defer { withExtendedLifetime(desktop) {} }
		model.setScreenOpen(true)
		#expect(await eventually { subscriptions.active == [true] })

		// Every connection brings a device.status: a desktop that lost the phone for a moment forgot it.
		_ = try subscriptions.connection?.emitEvent(.deviceStatus, payload: ["deviceName": "MacBook Pro", "lanEndpoints": [], "relayEnabled": false, "runningSessionCount": 0, "screen": true])
		#expect(await eventually { subscriptions.active == [true, true] })
	}

	@Test func neverAsksADesktopThatDoesNotCaptureOnDemand() async throws {
		let subscriptions = Subscriptions()
		let (model, desktop) = try await pairedModel(capturesOnDemand: false, subscriptions: subscriptions)
		defer { withExtendedLifetime(desktop) {} }
		model.setScreenOpen(true)
		await sleep(ms: 200)
		model.setScreenOpen(false)
		await sleep(ms: 100)
		#expect(subscriptions.active.isEmpty)
		#expect(model.screen == nil)
	}

	@Test func pointsTheRemoteDesktopAtTheRelayViewer() async throws {
		let subscriptions = Subscriptions()
		let (model, desktop) = try await pairedModel(capturesOnDemand: true, subscriptions: subscriptions)
		defer { withExtendedLifetime(desktop) {} }
		#expect(model.remoteDesktopTarget == "wss://relay.example/v2/desktop/pair-1234567890abcdef/viewer#pairing=secret-1234567890abcdef")
	}
}
