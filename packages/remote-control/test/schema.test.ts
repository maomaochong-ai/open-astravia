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
				protocolVersion: 1,
				role: "mobile",
				deviceId: "mobile-1",
				deviceName: "Phone",
				capabilities: { chat: true, sessionRead: true },
				connectionId: "connection-1",
			}),
		).toBe(true);
	});

	it("rejects authority-expanding unknown fields", () => {
		expect(validate({ type: "ack", sequence: 1, execute: "anything" })).toBe(false);
	});
});
