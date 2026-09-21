import { describe, expect, it } from "vitest";
import { createDefaultAppMonitorData, normalizeAppMonitorData } from "./app-monitor-data";

describe("app monitor extension failures", () => {
	it("uses the generic extension bucket for new data", () => {
		expect(createDefaultAppMonitorData(0).errors).toEqual({
			runtime: 0,
			provider: 0,
			tool: 0,
			extension: 0,
		});
	});

	it("merges the historical MCP bucket while loading persisted data", () => {
		expect(normalizeAppMonitorData({ errors: { extension: 3, mcp: 2 } }).errors.extension).toBe(5);
	});

	it("preserves MCP ability lifecycle summaries", () => {
		const data = normalizeAppMonitorData({
			resources: {
				byResource: {
					"mcp:demo": {
						kind: "mcp",
						id: "demo",
						events: 1,
						installed: 1,
						lastOperation: "installed",
						lastOperationAt: 10,
					},
				},
			},
		});

		expect(data.resources.byResource["mcp:demo"]).toMatchObject({
			kind: "mcp",
			id: "demo",
			installed: 1,
			lastOperation: "installed",
		});
		expect(data.resources.recentByKind.mcp).toMatchObject({ kind: "mcp", id: "demo" });
	});
});
