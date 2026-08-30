import { describe, expect, it } from "vitest";
import { asAgentToolRegistration, asAppActionRegistration } from "./plugin-input-parsers.js";

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
	it("only forwards current tool metadata", () => {
		const parsed = asAgentToolRegistration({
			...registration(),
			scope_use: ["cli"],
			requires: ["knowledge"],
			side_effect: "heavy",
		});
		expect(parsed).toMatchObject({ name: "demo_tool", scope_use: ["cli"], requires: ["knowledge"] });
		expect(parsed).not.toHaveProperty("side_effect");
	});

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

describe("plugin App Action usage parser", () => {
	const usage = {
		target: "Vetta Desktop settings",
		useWhen: "The user wants to change Vetta settings.",
		avoidWhen: "Editing project configuration files.",
		alternatives: "Edit the project's files instead.",
	};
	const action = {
		id: "settings",
		title: "Settings",
		summary: "Read settings",
		effect: "read",
		inputSchema: { type: "object" },
		handlerId: "handler",
		activationId: "activation",
	};

	it("preserves model-visible usage while stripping unknown fields", () => {
		expect(
			asAppActionRegistration({ ...action, usage: { ...usage, target: ` ${usage.target} `, extra: true } }).usage,
		).toEqual(usage);
	});

	it("allows registrations without routing metadata", () => {
		expect(asAppActionRegistration(action).usage).toBeUndefined();
	});

	it.each([null, [], "settings", {}, { ...usage, target: " " }, { ...usage, useWhen: 1 }])(
		"rejects malformed usage metadata: %j",
		(value) => {
			expect(() => asAppActionRegistration({ ...action, usage: value })).toThrow();
		},
	);
});
