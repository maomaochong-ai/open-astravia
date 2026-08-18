import { describe, expect, it, vi } from "vitest";
import type { DesktopConfig } from "../config/desktop-config-store.js";
import { AgentSettingsService } from "./agent-settings-service.js";

function createConfig(): DesktopConfig {
	return {
		projects: [],
		archivedProjects: [],
		workspacePath: "C:\\workspace",
		defaultExecutionMode: "full-access",
		notificationsEnabled: true,
		experimental: { vettaCli: false, promptPrediction: false, agentSkills: true },
	};
}

describe("AgentSettingsService", () => {
	it("returns normalized experimental defaults", async () => {
		const service = new AgentSettingsService({
			readConfig: async () => ({ ...createConfig(), experimental: undefined }),
			writeConfig: vi.fn(),
		});

		await expect(service.getExperimental()).resolves.toEqual({
			vettaCli: true,
			promptPrediction: false,
			agentSkills: true,
		});
	});

	it("atomically merges a partial update without dropping adjacent config", async () => {
		const writeConfig = vi.fn<(config: DesktopConfig) => Promise<void>>(async () => {});
		const service = new AgentSettingsService({
			readConfig: async () => createConfig(),
			writeConfig,
		});

		await expect(service.setExperimental({ promptPrediction: true })).resolves.toEqual({
			vettaCli: false,
			promptPrediction: true,
			agentSkills: true,
		});
		expect(writeConfig).toHaveBeenCalledWith({
			...createConfig(),
			experimental: { vettaCli: false, promptPrediction: true, agentSkills: true },
		});
	});
});
