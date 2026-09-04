import { parseCapabilityJsonValue } from "@vetta/capability-sdk";
import { describe, expect, it } from "vitest";
import { normalizePluginNetworkRequest } from "./plugin-network-request";

describe("normalizePluginNetworkRequest", () => {
	it("removes explicitly undefined optional fields before Capability validation", () => {
		const request = normalizePluginNetworkRequest({
			url: "https://jsk.nbyz.cn/prod-api/gis/cityFeature/tree/current",
			method: "GET",
			headers: { Accept: "application/json" },
			body: undefined,
			responseType: "json",
			timeoutMs: 30_000,
		});

		expect(Object.hasOwn(request, "body")).toBe(false);
		expect(() => parseCapabilityJsonValue(request)).not.toThrow();
	});

	it("preserves a defined JSON body", () => {
		const body = { type: "json" as const, value: { pageNum: 1 } };
		expect(normalizePluginNetworkRequest({ url: "https://jsk.nbyz.cn", method: "POST", body })).toEqual({
			url: "https://jsk.nbyz.cn",
			method: "POST",
			body,
		});
	});
});
