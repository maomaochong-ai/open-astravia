import { describe, expect, it } from "vitest";
import { asAgentHookRegistration, asAgentToolRegistration, asAppActionRegistration } from "./plugin-input-parsers.js";

describe("plugin IPC input parsers", () => {
	it("normalizes bounded Agent tool registration input", () => {
		expect(
			asAgentToolRegistration({
				id: "tool",
				name: "tool_name",
				description: "description",
				parameters: {},
				handlerId: "handler",
				timeoutMs: 999_999,
			}),
		).toMatchObject({ id: "tool", timeoutMs: 300_000 });
	});

	it("rejects hooks without an explicit non-empty scope", () => {
		expect(() =>
			asAgentHookRegistration({ id: "hook", eventName: "SessionStart", handlerId: "handler", scope_use: [] }),
		).toThrow("scope_use must not be empty");
	});

	it("rejects malformed app action identifiers at the IPC boundary", () => {
		expect(() =>
			asAppActionRegistration({
				id: "Invalid Action",
				title: "Title",
				summary: "Summary",
				effect: "read",
				inputSchema: {},
				handlerId: "handler",
				activationId: "activation",
			}),
		).toThrow("Invalid app action id");
	});
});
