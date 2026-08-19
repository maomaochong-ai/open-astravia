import { describe, expect, it } from "vitest";
import { decodeRemoteFrame, encodeRemoteFrame, parseRemoteFrame, RemoteProtocolError } from "../src/index.js";

const hello = {
	type: "hello",
	protocolVersion: 1,
	role: "mobile",
	deviceId: "phone-1",
	deviceName: "Test phone",
	connectionId: "conn-1",
	capabilities: { chat: true, sessionRead: true },
} as const;

describe("remote protocol", () => {
	it("round-trips a hello frame as newline-delimited JSON", () => {
		expect(parseRemoteFrame(encodeRemoteFrame(hello))).toEqual(hello);
	});

	it("rejects unsupported versions and methods at the boundary", () => {
		expect(() => decodeRemoteFrame({ ...hello, protocolVersion: 2 })).toThrow(RemoteProtocolError);
		expect(() => decodeRemoteFrame({ type: "request", requestId: "r1", method: "shell.exec" })).toThrow(
			RemoteProtocolError,
		);
	});

	it("requires positive event sequences", () => {
		expect(() => decodeRemoteFrame({ type: "event", eventId: "e1", sequence: 0, name: "session.state" })).toThrow(
			RemoteProtocolError,
		);
	});

	it("requires failed responses to carry a structured error", () => {
		expect(() => decodeRemoteFrame({ type: "response", requestId: "r1", success: false })).toThrow(
			RemoteProtocolError,
		);
	});
});
