import type { IpcRenderer } from "electron";
import { describe, expect, it, vi } from "vitest";
import { createSessionApi } from "./session.js";

describe("createSessionApi trace propagation", () => {
	it("forwards the same correlation envelope for create and prompt", async () => {
		const invoke = vi.fn(async () => undefined);
		const ipc = { invoke } as unknown as IpcRenderer;
		const session = createSessionApi(ipc).session;
		const traceContext = { interactionId: "00000000-0000-4000-8000-000000000001" };

		await session.create({ cwd: "C:/workspace" }, "conversation", traceContext);
		await session.prompt("session-1", { text: "hello" }, traceContext);

		expect(invoke).toHaveBeenNthCalledWith(
			1,
			"vetta:session:create",
			{ cwd: "C:/workspace" },
			"conversation",
			traceContext,
		);
		expect(invoke).toHaveBeenNthCalledWith(2, "vetta:session:prompt", "session-1", { text: "hello" }, traceContext);
	});

	it("exposes MCP Task snapshot, cancellation and cleanup channels", async () => {
		const invoke = vi.fn(async () => undefined);
		const ipc = { invoke } as unknown as IpcRenderer;
		const session = createSessionApi(ipc).session;

		await session.listMcpTasks("session-1");
		await session.cancelMcpTask("task-record-1");
		await session.clearFinishedMcpTasks("session-1");

		expect(invoke).toHaveBeenNthCalledWith(1, "vetta:session:mcp-tasks-list", "session-1");
		expect(invoke).toHaveBeenNthCalledWith(2, "vetta:session:mcp-tasks-cancel", "task-record-1");
		expect(invoke).toHaveBeenNthCalledWith(3, "vetta:session:mcp-tasks-clear-finished", "session-1");
	});

	it("exposes the MCP Apps surface proxy channels", async () => {
		const invoke = vi.fn(async () => undefined);
		const ipc = { invoke } as unknown as IpcRenderer;
		const session = createSessionApi(ipc).session;

		await session.getMcpAppSurface("surface-1");
		await session.callMcpAppTool({ surfaceId: "surface-1", name: "refresh", arguments: { page: 1 } });
		await session.readMcpAppResource({ surfaceId: "surface-1", uri: "ui://data" });
		await session.releaseMcpAppSurface("surface-1");

		expect(invoke).toHaveBeenNthCalledWith(1, "vetta:session:mcp-app-surface-get", "surface-1");
		expect(invoke).toHaveBeenNthCalledWith(2, "vetta:session:mcp-app-call-tool", {
			surfaceId: "surface-1",
			name: "refresh",
			arguments: { page: 1 },
		});
		expect(invoke).toHaveBeenNthCalledWith(3, "vetta:session:mcp-app-read-resource", {
			surfaceId: "surface-1",
			uri: "ui://data",
		});
		expect(invoke).toHaveBeenNthCalledWith(4, "vetta:session:mcp-app-release", "surface-1");
	});

	it("forwards session search requests through the dedicated channel", async () => {
		const invoke = vi.fn(async () => "search-1");
		const ipc = { invoke, on: vi.fn(), removeListener: vi.fn() } as unknown as IpcRenderer;
		const session = createSessionApi(ipc).session;

		await session.searchSessions({ query: "release plan", limit: 20 }, vi.fn());

		expect(invoke).toHaveBeenCalledWith("vetta:session:search-sessions", expect.any(String), {
			query: "release plan",
			limit: 20,
		});
	});
});
