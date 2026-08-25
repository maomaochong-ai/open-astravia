import { describe, expect, it } from "vitest";
import { asAgentToolRegistration } from "./plugin-input-parsers.js";

function registration(configuration?: unknown): Record<string, unknown> {
	return {
		id: "tool",
		name: "demo_tool",
		description: "Demo tool",
		parameters: { type: "object" },
		handlerId: "handler",
		...(configuration === undefined ? {} : { configuration }),
	};
}

describe("plugin agent tool configuration parser", () => {
	it("keeps configuration optional for tools without settings", () => {
		expect(asAgentToolRegistration(registration()).configuration).toBeUndefined();
	});

	it("normalizes an adapter association and rejects duplicate setting keys", () => {
		expect(asAgentToolRegistration(registration({ settingKeys: [" mode "] })).configuration).toEqual({
			settingKeys: ["mode"],
			support: "adapter",
		});
		expect(() => asAgentToolRegistration(registration({ settingKeys: ["mode", "mode"] }))).toThrow(
			"must not contain duplicates",
		);
	});
});
