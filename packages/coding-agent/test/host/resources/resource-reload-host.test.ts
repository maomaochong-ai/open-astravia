import { describe, expect, it, vi } from "vitest";
import { CodingAgentResourceReloadHost } from "../../../src/host/resources/resource-reload-host.js";

describe("CodingAgentResourceReloadHost", () => {
	it("preserves the existing reload order inside the Extension lifecycle", async () => {
		const calls: string[] = [];
		const host = new CodingAgentResourceReloadHost({
			settingsManager: { reload: () => calls.push("settings") },
			resourceLoader: { reload: async () => void calls.push("resources") },
			resetProviders: () => calls.push("providers"),
			afterReload: () => {
				calls.push("extensions");
			},
			runWithExtensionLifecycle: async (operation) => {
				calls.push("shutdown");
				await operation();
				calls.push("start");
			},
		});

		await host.reload();

		expect(calls).toEqual(["shutdown", "settings", "providers", "resources", "extensions", "start"]);
	});

	it("does not run post-reload work after resource loading fails", async () => {
		const afterReload = vi.fn();
		const host = new CodingAgentResourceReloadHost({
			settingsManager: { reload: () => {} },
			resourceLoader: { reload: async () => Promise.reject(new Error("reload failed")) },
			resetProviders: () => {},
			afterReload,
			runWithExtensionLifecycle: (operation) => operation(),
		});

		await expect(host.reload()).rejects.toThrow("reload failed");
		expect(afterReload).not.toHaveBeenCalled();
	});
});
