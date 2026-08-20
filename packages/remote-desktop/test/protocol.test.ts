import { describe, expect, it } from "vitest";
import { decodeRemoteDesktopSignal, decodeRemoteInputMessage, RemoteDesktopProtocolError } from "../src/index.js";

describe("remote desktop protocol", () => {
	it("accepts the relay peer-ready event without peer-controlled fields", () => {
		expect(decodeRemoteDesktopSignal({ type: "peer_ready", protocolVersion: 1 })).toEqual({
			type: "peer_ready",
			protocolVersion: 1,
		});
		expect(() =>
			decodeRemoteDesktopSignal({ type: "peer_ready", protocolVersion: 1, sessionId: "injected" }),
		).toThrow("unsupported field: sessionId");
	});

	it("validates normalized pointer input", () => {
		expect(decodeRemoteInputMessage({ type: "pointer.move", sequence: 1, x: 0.25, y: 0.75 })).toEqual({
			type: "pointer.move",
			sequence: 1,
			x: 0.25,
			y: 0.75,
		});
		expect(() => decodeRemoteInputMessage({ type: "pointer.move", sequence: 1, x: 1.1, y: 0 })).toThrow(
			RemoteDesktopProtocolError,
		);
	});

	it("rejects authority-expanding unknown input fields", () => {
		expect(() =>
			decodeRemoteInputMessage({ type: "key", sequence: 1, code: "KeyA", action: "down", text: "secret" }),
		).toThrow("unsupported field: text");
	});

	it("bounds SDP and validates protocol versions", () => {
		expect(() =>
			decodeRemoteDesktopSignal({ type: "offer", protocolVersion: 2, sessionId: "session", sdp: "v=0" }),
		).toThrow("unsupported desktop protocol version");
		expect(() =>
			decodeRemoteDesktopSignal({
				type: "offer",
				protocolVersion: 1,
				sessionId: "session",
				sdp: "x".repeat(262_145),
			}),
		).toThrow(RemoteDesktopProtocolError);
	});
});
