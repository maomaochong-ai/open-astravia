import { describe, expect, it } from "vitest";
import {
	decodeRemoteFrame,
	decodeSessionFrame,
	encodeRemoteFrame,
	generateIdentityKeyPair,
	parseRemoteFrame,
	RemoteProtocolError,
	toBase64Url,
} from "../src/index.js";

const identity = toBase64Url(generateIdentityKeyPair().publicKey);
const ephemeral = toBase64Url(generateIdentityKeyPair().publicKey);

const hello = {
	type: "hello",
	protocolVersion: 2,
	role: "mobile",
	deviceId: "phone-1",
	deviceName: "Test phone",
	connectionId: "conn-1",
	capabilities: { chat: true, sessionRead: true },
	identityKey: identity,
	ephemeralKey: ephemeral,
} as const;

describe("remote protocol v2", () => {
	it("round-trips a hello frame as newline-delimited JSON", () => {
		expect(parseRemoteFrame(encodeRemoteFrame(hello))).toEqual(hello);
	});

	it("rejects protocol v1 handshakes and unknown methods at the boundary", () => {
		expect(() => decodeRemoteFrame({ ...hello, protocolVersion: 1 })).toThrow(RemoteProtocolError);
		expect(() => decodeRemoteFrame({ type: "request", requestId: "r1", method: "shell.exec" })).toThrow(
			RemoteProtocolError,
		);
	});

	it("accepts the upload, model and session management requests", () => {
		for (const method of [
			"session.upload",
			"model.list",
			"session.configure",
			"session.rename",
			"session.pin",
			"session.delete",
		]) {
			expect(decodeRemoteFrame({ type: "request", requestId: "r1", method, sessionId: "s1" })).toMatchObject({
				method,
			});
		}
	});

	it("requires well-formed X25519 keys in the handshake", () => {
		expect(() => decodeRemoteFrame({ ...hello, identityKey: "short" })).toThrow(RemoteProtocolError);
		expect(() => decodeRemoteFrame({ ...hello, ephemeralKey: `${ephemeral}=` })).toThrow(RemoteProtocolError);
		expect(() =>
			decodeRemoteFrame({
				type: "hello_ack",
				protocolVersion: 2,
				connectionId: "conn-1",
				peerDeviceId: "desktop-1",
				peerIdentityKey: identity,
				peerEphemeralKey: "not-a-key",
			}),
		).toThrow(RemoteProtocolError);
	});

	it("validates sealed envelopes without looking inside", () => {
		const nonce = "A".repeat(32);
		expect(decodeRemoteFrame({ type: "sealed", nonce, ciphertext: "abc_-123" })).toEqual({
			type: "sealed",
			nonce,
			ciphertext: "abc_-123",
		});
		expect(() => decodeRemoteFrame({ type: "sealed", nonce: "A".repeat(31), ciphertext: "abc" })).toThrow(
			RemoteProtocolError,
		);
		expect(() => decodeRemoteFrame({ type: "sealed", nonce, ciphertext: "not base64!" })).toThrow(
			RemoteProtocolError,
		);
	});

	it("refuses handshake frames inside a sealed envelope", () => {
		expect(() => decodeSessionFrame(hello)).toThrow(RemoteProtocolError);
		expect(decodeSessionFrame({ type: "ack", sequence: 3 })).toEqual({ type: "ack", sequence: 3 });
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
		expect(() =>
			decodeRemoteFrame({
				type: "response",
				requestId: "r1",
				success: false,
				error: { code: "made_up", message: "x", retryable: false },
			}),
		).toThrow(RemoteProtocolError);
	});

	it("accepts the relay-owned frames", () => {
		expect(decodeRemoteFrame({ type: "peer_status", online: true })).toEqual({ type: "peer_status", online: true });
		expect(
			decodeRemoteFrame({
				type: "pairing_pending",
				connectionId: "conn-1",
				peerDeviceId: "desktop-1",
				peerIdentityKey: identity,
			}),
		).toMatchObject({ type: "pairing_pending" });
	});
});
