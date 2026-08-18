import { afterEach, describe, expect, it, vi } from "vitest";
import { createOfficialSkillsApi } from "./plugin-official-skills.js";

afterEach(() => {
	Reflect.deleteProperty(globalThis, "window");
});

describe("createOfficialSkillsApi", () => {
	it("routes skill operations through the plugin capability session", async () => {
		const installed = {
			review: {
				name: "review",
				version: "1.0.0",
				installedAt: "2026-01-01T00:00:00.000Z",
				source: "market",
				enabled: true,
				type: "skill",
			},
		};
		const skills = {
			list: vi.fn().mockResolvedValue([]),
			listInstalled: vi.fn().mockResolvedValue(installed),
			setEnabled: vi.fn().mockResolvedValue({ name: "review", enabled: false }),
			uninstall: vi.fn().mockResolvedValue(undefined),
		};
		const installFromMarketSlug = vi.fn().mockResolvedValue({
			name: "review",
			type: "skill",
			version: "1.0.0",
			updated: false,
		});
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: {
				vetta: {
					plugins: { internalCapabilities: { skills } },
					skills: { installFromMarketSlug },
				},
			},
		});
		const assertOfficial = vi.fn();
		const api = createOfficialSkillsApi(assertOfficial, "capability-session");

		await expect(api.list("C:/workspace")).resolves.toEqual([]);
		await expect(api.getManifest()).resolves.toEqual(installed);
		await expect(api.setEnabled("review", false)).resolves.toEqual({ name: "review", enabled: false });
		await expect(api.uninstall("review")).resolves.toBeUndefined();
		await expect(api.installFromMarket("skill", "review")).resolves.toEqual({
			name: "review",
			type: "skill",
			version: "1.0.0",
			updated: false,
		});

		expect(assertOfficial).toHaveBeenCalledTimes(5);
		expect(skills.list).toHaveBeenCalledWith("capability-session", "C:/workspace");
		expect(skills.listInstalled).toHaveBeenCalledWith("capability-session");
		expect(skills.setEnabled).toHaveBeenCalledWith("capability-session", "review", false);
		expect(skills.uninstall).toHaveBeenCalledWith("capability-session", "review", undefined);
		expect(installFromMarketSlug).toHaveBeenCalledWith("skill", "review");
	});
});
