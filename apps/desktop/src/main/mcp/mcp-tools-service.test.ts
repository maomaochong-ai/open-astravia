import type { McpClientHandle } from "@vetta/runtime-mcp";
import { describe, expect, it, vi } from "vitest";
import { McpToolsService } from "./mcp-tools-service.js";

vi.mock("../config/desktop-config-store.js", () => ({ DEFAULT_CONVERSATION_CWD: "/workspace" }));
vi.mock("../abilities/open-marketplace/open-marketplace-mcp-runtime-host.js", () => ({
	ensureOpenMarketplaceManagedMcpRuntime: vi.fn(),
}));
vi.mock("./mcp-settings-service.js", () => ({ readMcpConfig: vi.fn() }));

function fixture() {
	const close = vi.fn(async () => undefined);
	const listTools = vi
		.fn()
		.mockResolvedValueOnce({ tools: [{ name: "one", description: "First tool" }], nextCursor: "next" })
		.mockResolvedValueOnce({ tools: [{ name: "two", description: "Second tool" }] });
	const createClient = vi.fn(
		() =>
			({
				initialize: async () => ({ capabilities: { tools: {} } }),
				listTools,
				close,
			}) as unknown as McpClientHandle,
	);
	const service = new McpToolsService({
		loadServer: async () => ({ type: "http", url: "https://example.com/mcp" }),
		createClient,
	});
	return { service, listTools, close, createClient };
}

describe("McpToolsService", () => {
	it("discovers all pages, coalesces simultaneous requests and closes the client", async () => {
		const { service, listTools, close, createClient } = fixture();
		const first = service.list("remote");
		expect(service.list("remote")).toBe(first);
		expect(await first).toEqual([
			{ name: "one", description: "First tool" },
			{ name: "two", description: "Second tool" },
		]);
		expect(listTools).toHaveBeenLastCalledWith("next");
		expect(createClient).toHaveBeenCalledTimes(1);
		expect(close).toHaveBeenCalledOnce();
	});
	it("closes after discovery failure and permits retry", async () => {
		const { service, listTools, close } = fixture();
		listTools.mockReset().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ tools: [] });
		await expect(service.list("remote")).rejects.toThrow("offline");
		expect(close).toHaveBeenCalledOnce();
		expect(await service.list("remote")).toEqual([]);
		expect(close).toHaveBeenCalledTimes(2);
	});
	it("rejects disabled or missing servers before creating a connection", async () => {
		const createClient = vi.fn();
		const service = new McpToolsService({
			loadServer: async (name) => (name === "disabled" ? { command: "node", disabled: true } : undefined),
			createClient,
		});
		await expect(service.list("disabled")).rejects.toThrow("disabled");
		await expect(service.list("missing")).rejects.toThrow("not found");
		expect(createClient).not.toHaveBeenCalled();
	});
	it("rejects looping pagination and releases the client", async () => {
		const { service, listTools, close } = fixture();
		listTools.mockReset().mockResolvedValue({ tools: [], nextCursor: "loop" });
		await expect(service.list("remote")).rejects.toThrow("repeated a cursor");
		expect(close).toHaveBeenCalledOnce();
	});
});
