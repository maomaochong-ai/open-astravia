import {
	CODING_AGENT_COMPACTION_CONFIGURATION,
	CODING_AGENT_COMPACTION_CONFIGURATION_ID,
} from "@vetta/coding-agent/settings";
import { CODING_IMAGE_CONFIGURATION_ID, VETTA_OCR_CONFIGURATION_ID } from "@vetta/runtime-tools";
import { describe, expect, it, vi } from "vitest";
import {
	DesktopRuntimeConfigurationService,
	type DesktopRuntimeConfigurationServiceDependencies,
} from "./runtime-configuration-service.js";

function createHarness(initialSettings: Record<string, unknown> = {}) {
	let agentSettings: Record<string, unknown> = structuredClone(initialSettings);
	const logger = { info: vi.fn(), warn: vi.fn() };
	const dependencies: DesktopRuntimeConfigurationServiceDependencies = {
		readAgentSettings: () => agentSettings,
		updateAgentSettings: (mutate) => {
			agentSettings = structuredClone(agentSettings);
			mutate(agentSettings);
		},
		logger,
	};
	return {
		service: new DesktopRuntimeConfigurationService(dependencies),
		logger,
		readAgentSettings: () => agentSettings,
	};
}

describe("DesktopRuntimeConfigurationService", () => {
	it("exposes only built-in definitions with their consumers", async () => {
		expect(CODING_AGENT_COMPACTION_CONFIGURATION).toBeTypeOf("object");
		const harness = createHarness();
		const catalog = await harness.service.list();

		expect(catalog.entries.map(({ configurationId }) => configurationId)).toEqual([
			CODING_AGENT_COMPACTION_CONFIGURATION_ID,
			CODING_IMAGE_CONFIGURATION_ID,
			VETTA_OCR_CONFIGURATION_ID,
		]);
		expect(
			catalog.entries.find(({ configurationId }) => configurationId === CODING_IMAGE_CONFIGURATION_ID)?.consumers,
		).toContainEqual({
			kind: "runtime",
			id: "model-input-images",
			support: "native",
		});
		await harness.service.close();
	});

	it("presents the existing 20% free-space setting as an 80% used-context threshold", async () => {
		const harness = createHarness({
			compaction: {
				enabled: true,
				reserveTokens: 36_000,
				minFreePercent: 20,
				keepRecentTokens: 20_000,
			},
		});

		const catalog = await harness.service.list();
		expect(
			catalog.entries.find(({ configurationId }) => configurationId === CODING_AGENT_COMPACTION_CONFIGURATION_ID)
				?.value,
		).toEqual({
			enabled: true,
			reserveTokens: 36_000,
			contextThresholdPercent: 80,
			keepRecentTokens: 20_000,
		});
		await harness.service.close();
	});

	it("persists context compaction settings and exposes them to the next Turn", async () => {
		const harness = createHarness();
		await harness.service.set(CODING_AGENT_COMPACTION_CONFIGURATION_ID, {
			enabled: false,
			reserveTokens: 24_000,
			contextThresholdPercent: 85,
			keepRecentTokens: 12_000,
		});

		expect(harness.readAgentSettings().compaction).toEqual({
			enabled: false,
			reserveTokens: 24_000,
			minFreePercent: 15,
			keepRecentTokens: 12_000,
		});
		expect(harness.service.readCompactionSettings()).toEqual({
			enabled: false,
			reserveTokens: 24_000,
			minFreePercent: 15,
			keepRecentTokens: 12_000,
		});
		await expect(
			harness.service.set(CODING_AGENT_COMPACTION_CONFIGURATION_ID, { contextThresholdPercent: 101 }),
		).rejects.toThrow("contextThresholdPercent");
		await harness.service.close();
	});

	it("persists OCR configuration independently and preserves its local default", async () => {
		const harness = createHarness();
		await harness.service.set(VETTA_OCR_CONFIGURATION_ID, { cacheResults: false });
		expect(harness.readAgentSettings().ocr).toEqual({
			defaultProviderId: "desktop-app:ppocrv5",
			remoteProviderPolicy: "ask",
			cacheResults: false,
			defaultOutput: "text",
		});
		await expect(
			harness.service.set(VETTA_OCR_CONFIGURATION_ID, { remoteProviderPolicy: "sometimes" }),
		).rejects.toThrow("remote provider policy");
		await harness.service.close();
	});

	it("validates and persists nested image patches as a complete configuration", async () => {
		const harness = createHarness();
		await harness.service.set(CODING_IMAGE_CONFIGURATION_ID, { resize: { maxWidth: 640 } });

		const images = harness.readAgentSettings().images as Record<string, unknown>;
		expect((images.resize as Record<string, unknown>).maxWidth).toBe(640);
		expect((images.resize as Record<string, unknown>).maxHeight).toBe(1280);
		expect(harness.logger.info).toHaveBeenCalledWith("runtime configuration updated", {
			configurationId: CODING_IMAGE_CONFIGURATION_ID,
		});
		expect(JSON.stringify(harness.logger.info.mock.calls)).not.toContain("640");
		await expect(
			harness.service.set(CODING_IMAGE_CONFIGURATION_ID, { requestBudget: { lowWatermarkBytes: 20_000_000 } }),
		).rejects.toThrow("low watermark");
		await harness.service.close();
	});

	it("rejects configuration ids the host does not own", async () => {
		const harness = createHarness();
		await expect(harness.service.set("plugin.demo.settings", { mode: "safe" })).rejects.toThrow("not editable");
		await harness.service.close();
	});
});
