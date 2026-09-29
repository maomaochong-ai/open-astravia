import { describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../../shared/notification-preferences.js";
import type { DesktopConfig } from "../config/desktop-config-store.js";
import { AgentSettingsService } from "./agent-settings-service.js";

function createConfig(): DesktopConfig {
	return {
		schemaVersion: 2,
		projects: [],
		archivedProjects: [],
		workspacePath: "C:\\workspace",
		defaultExecutionMode: "full-access",
		notificationsEnabled: true,
		notificationPreferences: DEFAULT_NOTIFICATION_PREFERENCES,
		experimental: { vettaCli: false, promptPrediction: false, agentSkills: true },
		imageGeneration: {},
	};
}

describe("AgentSettingsService", () => {
	it("returns normalized experimental defaults", async () => {
		const service = new AgentSettingsService({
			readConfig: async () => ({ ...createConfig(), experimental: undefined }),
			updateConfig: vi.fn(),
		});

		await expect(service.getExperimental()).resolves.toEqual({
			vettaCli: true,
			promptPrediction: false,
			agentSkills: true,
		});
	});

	it("atomically merges a partial update without dropping adjacent config", async () => {
		const updateConfig = vi.fn(async (update: (current: DesktopConfig) => DesktopConfig | Promise<DesktopConfig>) =>
			update(createConfig()),
		);
		const service = new AgentSettingsService({
			readConfig: async () => createConfig(),
			updateConfig,
		});

		await expect(service.setExperimental({ promptPrediction: true })).resolves.toEqual({
			vettaCli: false,
			promptPrediction: true,
			agentSkills: true,
		});
		expect(await updateConfig.mock.results[0]?.value).toEqual({
			...createConfig(),
			experimental: { vettaCli: false, promptPrediction: true, agentSkills: true },
		});
	});

	it("merges and clears image provider preferences without dropping other settings", async () => {
		const written: DesktopConfig[] = [];
		let current: DesktopConfig = {
			...createConfig(),
			imageGeneration: { textToImageProviderId: "remote:images" },
		};
		const service = new AgentSettingsService({
			readConfig: async () => current,
			updateConfig: async (update) => {
				current = await update(current);
				written.push(current);
				return current;
			},
		});

		await expect(service.setImageGeneration({ imageToImageProviderId: "remote:edit" })).resolves.toEqual({
			textToImageProviderId: "remote:images",
			imageToImageProviderId: "remote:edit",
		});
		await expect(service.setImageGeneration({ textToImageProviderId: null })).resolves.toEqual({
			imageToImageProviderId: "remote:edit",
		});
		expect(written.at(-1)).toEqual({
			...createConfig(),
			imageGeneration: { imageToImageProviderId: "remote:edit" },
		});
	});

	it("stores model preferences with their provider and clears stale models when the provider changes", async () => {
		let current: DesktopConfig = {
			...createConfig(),
			imageGeneration: {
				textToImageProviderId: "cpa:images",
				textToImageModelId: "codex/gpt-image-2",
			},
		};
		const service = new AgentSettingsService({
			readConfig: async () => current,
			updateConfig: async (update) => {
				current = await update(current);
				return current;
			},
		});

		await expect(
			service.setImageGeneration({
				textToImageProviderId: "other:images",
			}),
		).resolves.toEqual({ textToImageProviderId: "other:images" });
		await expect(
			service.setImageGeneration({
				textToImageProviderId: "cpa:images",
				textToImageModelId: "antigravity/gemini-image",
			}),
		).resolves.toEqual({
			textToImageProviderId: "cpa:images",
			textToImageModelId: "antigravity/gemini-image",
		});
	});
});
