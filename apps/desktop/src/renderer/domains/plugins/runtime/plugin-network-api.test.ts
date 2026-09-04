// @vitest-environment jsdom

import type { InstalledPlugin } from "@preload/api";
import { parseCapabilityJsonValue } from "@vetta/capability-sdk";
import type { PluginNetworkResponse } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginNetworkApi } from "./plugin-network-api";

const networkRequest = vi.fn(async (_sessionId: string, request: unknown): Promise<PluginNetworkResponse<unknown>> => {
	parseCapabilityJsonValue(request);
	return { ok: true, status: 200, statusText: "OK", headers: {}, body: { code: 200, data: [] } };
});

const plugin = {
	id: "jsk-map",
	permissions: ["network.fetch"],
	grantedPermissions: ["network.fetch"],
} as InstalledPlugin;

describe("plugin network API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { plugins: { networkRequest } },
		});
	});

	it("carries a GET request through the preload boundary as valid Capability JSON", async () => {
		const network = createPluginNetworkApi(plugin, "capability-session");

		await expect(
			network.request({
				url: "https://jsk.nbyz.cn/prod-api/gis/cityFeature/tree/current",
				method: "GET",
				headers: { Accept: "application/json" },
				body: undefined,
				responseType: "json",
				timeoutMs: 30_000,
			}),
		).resolves.toMatchObject({ ok: true, status: 200 });
		const forwarded = networkRequest.mock.calls[0]?.[1];
		expect(Object.hasOwn(forwarded as object, "body")).toBe(false);
		expect(networkRequest).toHaveBeenCalledWith("capability-session", {
			url: "https://jsk.nbyz.cn/prod-api/gis/cityFeature/tree/current",
			method: "GET",
			headers: { Accept: "application/json" },
			responseType: "json",
			timeoutMs: 30_000,
		});
	});
});
