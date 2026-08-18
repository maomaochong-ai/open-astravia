import { afterEach, describe, expect, it, vi } from "vitest";
import { createOfficialAgentApi } from "./plugin-official-agent.js";

afterEach(() => {
	Reflect.deleteProperty(globalThis, "window");
});

describe("createOfficialAgentApi", () => {
	it("routes experimental settings through the plugin capability session", async () => {
		const settings = { vettaCli: true, promptPrediction: false, agentSkills: true };
		const agentSettings = {
			getExperimental: vi.fn().mockResolvedValue(settings),
			setExperimental: vi.fn().mockResolvedValue({ ...settings, promptPrediction: true }),
		};
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { vetta: { plugins: { internalCapabilities: { agentSettings } } } },
		});
		const assertOfficial = vi.fn();
		const api = createOfficialAgentApi(assertOfficial, "capability-session");

		await expect(api.getExperimental()).resolves.toEqual(settings);
		await expect(api.setExperimental({ promptPrediction: true })).resolves.toEqual({
			...settings,
			promptPrediction: true,
		});

		expect(assertOfficial).toHaveBeenCalledTimes(2);
		expect(agentSettings.getExperimental).toHaveBeenCalledWith("capability-session");
		expect(agentSettings.setExperimental).toHaveBeenCalledWith("capability-session", {
			promptPrediction: true,
		});
	});
});
