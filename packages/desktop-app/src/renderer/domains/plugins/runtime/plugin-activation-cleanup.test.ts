import { describe, expect, it, vi } from "vitest";
import { PluginActivationCleanupController } from "./plugin-activation-cleanup";

describe("PluginActivationCleanupController", () => {
	it("cleans only the activation instance that owns the controller", async () => {
		const oldCleanup = vi.fn();
		const newCleanup = vi.fn();
		const oldActivation = new PluginActivationCleanupController();
		const newActivation = new PluginActivationCleanupController();
		oldActivation.set(oldCleanup);
		newActivation.set({ dispose: newCleanup });

		await oldActivation.dispose();
		await oldActivation.dispose();

		expect(oldCleanup).toHaveBeenCalledOnce();
		expect(newCleanup).not.toHaveBeenCalled();
		await newActivation.dispose();
		expect(newCleanup).toHaveBeenCalledOnce();
	});
});
