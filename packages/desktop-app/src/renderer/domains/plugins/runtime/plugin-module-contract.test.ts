import { describe, expect, it, vi } from "vitest";
import { extractPluginReloadToken, normalizePluginModule } from "./plugin-module-contract";

describe("plugin module loader", () => {
	it("normalizes default and named activation exports", () => {
		const defaultDefinition = { activate: vi.fn() };
		expect(normalizePluginModule({ default: defaultDefinition })).toBe(defaultDefinition);

		const activate = vi.fn();
		const deactivate = vi.fn();
		expect(normalizePluginModule({ activate, deactivate })).toEqual({ activate, deactivate });
	});

	it("rejects modules without an activation contract", () => {
		expect(() => normalizePluginModule(null)).toThrow("Plugin module must export a plugin definition");
		expect(() => normalizePluginModule({})).toThrow(
			"Plugin module must export default definePlugin(...) or activate()",
		);
	});

	it("extracts supported cache-busting tokens", () => {
		expect(extractPluginReloadToken("https://example.test/mf.json?reload=next")).toBe("next");
		expect(extractPluginReloadToken("https://example.test/plugin.js?v=2")).toBe("2");
		expect(extractPluginReloadToken("not a url")).toBeNull();
	});
});
