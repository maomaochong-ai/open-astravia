import { afterEach, describe, expect, it, vi } from "vitest";
import { createOfficialMcpApi } from "./plugin-official-mcp.js";

afterEach(() => {
	Reflect.deleteProperty(globalThis, "window");
});

describe("createOfficialMcpApi", () => {
	it("routes MCP operations through the capability session", async () => {
		const summary = { name: "web", type: "http" as const, disabled: false, url: "https://mcp.example.com" };
		const detail = { ...summary, headers: { Authorization: "***" } };
		const mcp = {
			list: vi.fn().mockResolvedValue([summary]),
			get: vi.fn().mockResolvedValue(detail),
			upsert: vi.fn().mockResolvedValue(detail),
			setEnabled: vi.fn().mockResolvedValue(undefined),
			remove: vi.fn().mockResolvedValue(undefined),
		};
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { vetta: { plugins: { internalCapabilities: { mcp } } } },
		});
		const assertOfficial = vi.fn();
		const api = createOfficialMcpApi(assertOfficial, "capability-session");

		await expect(api.list()).resolves.toEqual([summary]);
		await expect(api.get("web")).resolves.toEqual(detail);
		await expect(api.listNames()).resolves.toEqual(["web"]);
		await expect(api.upsert("web", { type: "http", url: "https://mcp.example.com" })).resolves.toEqual(detail);
		await expect(api.setEnabled("web", true)).resolves.toBeUndefined();
		await expect(api.remove("web")).resolves.toBeUndefined();

		expect(assertOfficial).toHaveBeenCalledTimes(6);
		expect(mcp.list).toHaveBeenCalledWith("capability-session");
		expect(mcp.get).toHaveBeenCalledWith("capability-session", "web");
		expect(mcp.upsert).toHaveBeenCalledWith("capability-session", "web", {
			type: "http",
			url: "https://mcp.example.com",
		});
		expect(mcp.setEnabled).toHaveBeenCalledWith("capability-session", "web", true);
		expect(mcp.remove).toHaveBeenCalledWith("capability-session", "web");
	});
});
