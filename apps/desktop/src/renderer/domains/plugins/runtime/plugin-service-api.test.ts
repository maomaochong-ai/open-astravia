// @vitest-environment jsdom

import type { InstalledPlugin } from "@preload/api";
import type { PluginServiceStatus } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginServiceApi } from "./plugin-service-api";

const readyStatus: PluginServiceStatus = {
	serviceId: "bridge",
	phase: "ready",
	version: "1.0.0",
	installed: true,
	recentOutput: "",
};
const getServiceStatus = vi.fn(async () => readyStatus);

const plugin = {
	id: "managed-service",
	serviceProviders: [{ id: "bridge" }],
} as InstalledPlugin;

describe("plugin service API activation lifecycle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { plugins: { getServiceStatus } },
		});
	});

	it("stops a delayed status poll at the renderer boundary after activation disposal", async () => {
		const disposers: Array<() => void> = [];
		const services = createPluginServiceApi(plugin, "capability-session", disposers);

		await expect(services.getStatus("bridge")).resolves.toEqual(readyStatus);
		for (const dispose of disposers) dispose();

		await expect(services.getStatus("bridge")).rejects.toMatchObject({ name: "AbortError" });
		expect(getServiceStatus).toHaveBeenCalledTimes(1);
	});
});
