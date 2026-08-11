import type { PluginContext } from "@vetta-org/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { applyStudioPanelWidth } from "../src/studio/studio-panel-width";

describe("Remotion Studio panel width", () => {
	it("uses the existing max-width API only while active", () => {
		const setActivityPanelWidth = vi.fn();
		const ctx = { ui: { setActivityPanelWidth } } as unknown as PluginContext;

		applyStudioPanelWidth(ctx, false);
		expect(setActivityPanelWidth).not.toHaveBeenCalled();

		applyStudioPanelWidth(ctx, true);
		expect(setActivityPanelWidth).toHaveBeenCalledOnce();
		expect(setActivityPanelWidth).toHaveBeenCalledWith("max");
	});
});
