import { describe, expect, it } from "vitest";
import {
	formatInviteCode,
	generateInviteCode,
	generateInvitePassword,
	inviteBoxId,
	inviteBoxUrl,
	isValidInvitePassword,
	normalizeInviteCode,
	openInvite,
	RemoteProtocolError,
	readInviteEnvelope,
	sealInvite,
} from "../src/index.js";

const URI = "vetta://pair?v=2&p=abcdefghijklmnop&s=secret";

describe("invite codes", () => {
	it("makes eight-character codes and six-digit passwords", () => {
		for (let round = 0; round < 50; round += 1) {
			const code = generateInviteCode();
			expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
			expect(normalizeInviteCode(code)).toBe(code);
			expect(isValidInvitePassword(generateInvitePassword())).toBe(true);
		}
	});

	it("reads a code however it was typed", () => {
		expect(formatInviteCode("K7Q29MXD")).toBe("K7Q2-9MXD");
		expect(normalizeInviteCode(" k7q2-9mxd ")).toBe("K7Q29MXD");
		expect(normalizeInviteCode("OIL00000")).toBe("01100000");
		expect(normalizeInviteCode("K7Q2-9MX")).toBeUndefined();
		expect(normalizeInviteCode("K7Q2-9MXU")).toBeUndefined();
		expect(isValidInvitePassword("12345")).toBe(false);
		expect(isValidInvitePassword("12345a")).toBe(false);
	});

	it("names the mailbox by a hash of the code only", () => {
		expect(inviteBoxId("K7Q29MXD")).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(inviteBoxId("K7Q29MXD")).not.toContain("K7Q2");
		expect(inviteBoxId("K7Q29MXD")).not.toBe(inviteBoxId("K7Q29MXE"));
		expect(inviteBoxUrl("wss://relay.example", "box")).toBe("https://relay.example/v2/invite/box");
		expect(inviteBoxUrl("ws://127.0.0.1:8787", "box")).toBe("http://127.0.0.1:8787/v2/invite/box");
	});

	it("opens only with the code and password it was sealed with", async () => {
		const envelope = await sealInvite(URI, "K7Q29MXD", "482913");
		expect(readInviteEnvelope(JSON.parse(JSON.stringify(envelope)))).toEqual(envelope);
		expect(JSON.stringify(envelope)).not.toContain("secret");
		await expect(openInvite(envelope, "K7Q29MXD", "482913")).resolves.toBe(URI);
		await expect(openInvite(envelope, "K7Q29MXD", "482914")).rejects.toBeInstanceOf(RemoteProtocolError);
		await expect(openInvite(envelope, "K7Q29MXE", "482913")).rejects.toBeInstanceOf(RemoteProtocolError);
	});

	it("matches the vector the phones check against", async () => {
		const nonce = new Uint8Array(24).map((_, index) => index);
		const envelope = await sealInvite("vetta://pair?v=2", "K7Q29MXD", "482913", () => nonce);
		expect(inviteBoxId("K7Q29MXD")).toBe(BOX_ID);
		expect(envelope).toEqual({ v: 1, nonce: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYX", ciphertext: CIPHERTEXT });
	});

	it("rejects malformed envelopes", () => {
		expect(readInviteEnvelope(null)).toBeUndefined();
		expect(readInviteEnvelope({ v: 2, nonce: "a".repeat(32), ciphertext: "b".repeat(40) })).toBeUndefined();
		expect(readInviteEnvelope({ v: 1, nonce: "short", ciphertext: "b".repeat(40) })).toBeUndefined();
		expect(readInviteEnvelope({ v: 1, nonce: "a".repeat(32), ciphertext: "b".repeat(9000) })).toBeUndefined();
	});
});

const BOX_ID = "oe8sfyla3JaUnRAk_OqKI8DJvl48e8IfsfQ1SK6dMS4";
const CIPHERTEXT = "7v0nMbc3Dzwj2xiCL-L0UvCWmf7PDe03MwwUW09QZzU";
