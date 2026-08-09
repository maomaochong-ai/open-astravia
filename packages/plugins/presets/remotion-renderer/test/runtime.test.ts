import type { PluginContext } from "@vetta-org/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import plugin from "../src/index";
import { getPluginContext } from "../src/runtime";

function createPluginContext(): PluginContext {
	return {
		ui: { registerActivityTab: vi.fn() },
		media: { registerProvider: vi.fn() },
		agent: { registerTool: vi.fn() },
		i18n: { t: vi.fn((key: string) => key) },
	} as unknown as PluginContext;
}

describe("Remotion renderer runtime", () => {
	it("keeps the new activation context when the previous instance deactivates", async () => {
		const previousContext = createPluginContext();
		const currentContext = createPluginContext();

		await plugin.activate(previousContext);
		await plugin.activate(currentContext);
		await plugin.deactivate?.();

		expect(getPluginContext()).toBe(currentContext);
	});
});
