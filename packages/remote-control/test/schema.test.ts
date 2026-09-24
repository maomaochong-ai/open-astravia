import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as AjvModule from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

const schema = JSON.parse(readFileSync(resolve(__dirname, "../schemas/remote-frame.schema.json"), "utf8"));
const AjvConstructor = (
	AjvModule as unknown as {
		readonly default: new (options: {
			readonly strict: boolean;
		}) => {
			compile(schema: unknown): (value: unknown) => boolean;
		};
	}
).default;
const validate = new AjvConstructor({ strict: true }).compile(schema);

describe("remote control JSON Schema", () => {
	it("accepts the language-neutral hello contract", () => {
		expect(
			validate({
				type: "hello",
				protocolVersion: 2,
				role: "mobile",
				deviceId: "mobile-1",
				deviceName: "Phone",
				capabilities: { chat: true, sessionRead: true },
				connectionId: "connection-1",
				identityKey: "A".repeat(43),
				ephemeralKey: "B".repeat(43),
			}),
		).toBe(true);
	});

	it("rejects protocol v1 handshakes and plaintext frames with unknown types", () => {
		expect(
			validate({
				type: "hello",
				protocolVersion: 1,
				role: "mobile",
				deviceId: "mobile-1",
				deviceName: "Phone",
				capabilities: { chat: true, sessionRead: true },
				connectionId: "connection-1",
			}),
		).toBe(false);
		expect(validate({ type: "sealed", nonce: "C".repeat(32), ciphertext: "abc" })).toBe(true);
		expect(validate({ type: "sealed", nonce: "C".repeat(32), ciphertext: "a b" })).toBe(false);
	});

	it("lists the same request methods the TypeScript and Swift readers accept", () => {
		for (const method of [
			"session.upload",
			"model.list",
			"session.configure",
			"session.rename",
			"session.pin",
			"session.delete",
		]) {
			expect(validate({ type: "request", requestId: "r1", method, sessionId: "s1", payload: {} })).toBe(true);
		}
	});

	it("rejects authority-expanding unknown fields", () => {
		expect(validate({ type: "ack", sequence: 1, execute: "anything" })).toBe(false);
	});
});
