import { CODING_IMAGE_CONFIGURATION_ID } from "@vetta/runtime-tools";
import { describe, expect, it, vi } from "vitest";
import {
	DesktopRuntimeConfigurationService,
	type DesktopRuntimeConfigurationServiceDependencies,
} from "./runtime-configuration-service.js";

function createHarness() {
	let agentSettings: Record<string, unknown> = {};
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
		const harness = createHarness();
		const catalog = await harness.service.list();

		expect(catalog.entries.map(({ configurationId }) => configurationId)).toEqual([CODING_IMAGE_CONFIGURATION_ID]);
		expect(catalog.entries[0]?.consumers).toContainEqual({
			kind: "runtime",
			id: "model-input-images",
			support: "native",
		});
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
