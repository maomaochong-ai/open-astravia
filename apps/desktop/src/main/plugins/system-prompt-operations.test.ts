import { describe, expect, it } from "vitest";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";
import {
	normalizeDynamicSystemPromptOperations,
	tryNormalizeDynamicSystemPromptOperations,
} from "./system-prompt-operations.js";

function plugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
	return {
		id: "demo",
		name: "Demo",
		version: "1.0.0",
		activeVersion: "1.0.0",
		pluginApiVersion: "^2.0.0",
		moduleFederation: { remoteName: "system_prompt_test", expose: "./plugin" },
		entryUrl: "vetta-plugin://demo/index.js",
		styleUrls: [],
		permissions: [],
		grantedPermissions: [],
		allowedNetworkHosts: [],
		allowedBrowserHosts: [],
		declaredCommands: [],
		grantedCommandNames: [],
		defaultLocale: "zh",
		locales: {},
		enabled: true,
		required: false,
		installedAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		source: "archive",
		trustLevel: "local",
		rootPath: "C:/plugins/demo",
		...overrides,
	};
}

const toolEffect = [{ type: "setToolEnabled", toolName: "write", enabled: false }];

describe("dynamic system prompt operation normalization", () => {
	it("keeps the permission guard fail-closed", () => {
		expect(() => normalizeDynamicSystemPromptOperations(plugin(), toolEffect)).toThrow(
			"Plugin demo cannot change runtime tool availability",
		);
	});

	it("turns a renderer response validation failure into a Promise-safe rejection value", () => {
		const result = tryNormalizeDynamicSystemPromptOperations(plugin(), toolEffect);

		expect(result).toEqual({
			ok: false,
			error: expect.objectContaining({ message: "Plugin demo cannot change runtime tool availability" }),
		});
	});

	it("accepts a runtime tool effect only when the permission is both declared and granted", () => {
		const result = tryNormalizeDynamicSystemPromptOperations(
			plugin({ permissions: ["agent.tools.control"], grantedPermissions: ["agent.tools.control"] }),
			toolEffect,
		);

		expect(result).toEqual({ ok: true, value: toolEffect });
	});
});
