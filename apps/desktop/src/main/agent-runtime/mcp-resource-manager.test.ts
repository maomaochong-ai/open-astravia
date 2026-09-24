import type { ManagedMcpRuntimeToolSource, McpRuntimeToolBinding } from "@vetta/runtime-mcp";
import { describe, expect, it, vi } from "vitest";
import { DesktopMcpResourceManager } from "./mcp-resource-manager.js";

describe("DesktopMcpResourceManager", () => {
	it("reuses one prewarmed application source across workspace acquisitions", async () => {
		const applicationDispose = vi.fn(async () => undefined);
		const workspaceDisposes: Array<ReturnType<typeof vi.fn>> = [];
		const createApplicationSource = vi.fn(async () => managedSource("shared", "application", applicationDispose));
		const createWorkspaceSource = vi.fn(async ({ cwd }: { cwd: string }) => {
			const dispose = vi.fn(async () => undefined);
			workspaceDisposes.push(dispose);
			return managedSource("workspace", cwd, dispose);
		});
		const manager = new DesktopMcpResourceManager({ createApplicationSource, createWorkspaceSource });

		await manager.prewarmApplication("C:/agent");
		const first = await manager.acquire({ cwd: "C:/team/first", agentDir: "C:/agent" });
		const second = await manager.acquire({ cwd: "C:/team/second", agentDir: "C:/agent" });

		expect(createApplicationSource).toHaveBeenCalledTimes(1);
		expect(createWorkspaceSource).toHaveBeenCalledTimes(2);
		expect((await first.source.refresh()).tools.map((binding) => binding.fingerprint)).toEqual([
			"application",
			"C:/team/first",
		]);
		await first.dispose();
		await second.dispose();
		expect(workspaceDisposes.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
		expect(applicationDispose).not.toHaveBeenCalled();

		await manager.dispose();
		expect(applicationDispose).toHaveBeenCalledTimes(1);
	});

	it("lets the workspace binding override an application tool with the same name", async () => {
		const manager = new DesktopMcpResourceManager({
			createApplicationSource: async () => managedSource("shared", "application"),
			createWorkspaceSource: async () => managedSource("shared", "workspace"),
		});
		const acquired = await manager.acquire({ cwd: "C:/team", agentDir: "C:/agent" });

		expect((await acquired.source.refresh()).tools).toEqual([expect.objectContaining({ fingerprint: "workspace" })]);

		await acquired.dispose();
		await manager.dispose();
	});

	it("retries application disposal failures without recreating the connection", async () => {
		const dispose = vi.fn().mockRejectedValueOnce(new Error("busy")).mockResolvedValue(undefined);
		const createApplicationSource = vi.fn(async () => managedSource("shared", "application", dispose));
		const manager = new DesktopMcpResourceManager({
			createApplicationSource,
			createWorkspaceSource: async () => managedSource("workspace", "workspace"),
		});
		await manager.prewarmApplication("C:/agent");

		await expect(manager.dispose()).rejects.toThrow("Desktop MCP resource disposal failed");
		await expect(manager.dispose()).resolves.toBeUndefined();
		expect(createApplicationSource).toHaveBeenCalledTimes(1);
		expect(dispose).toHaveBeenCalledTimes(2);
	});

	it("creates a new application generation after authentication ownership changes", async () => {
		let revision = "anonymous";
		const createApplicationSource = vi.fn(async () => managedSource("shared", revision));
		const manager = new DesktopMcpResourceManager({
			createApplicationSource,
			createWorkspaceSource: async () => managedSource("workspace", "workspace"),
			resolveApplicationRevision: () => revision,
		});
		await manager.prewarmApplication("C:/agent");
		revision = "authenticated";
		const acquired = await manager.acquire({ cwd: "C:/team", agentDir: "C:/agent" });

		expect(createApplicationSource).toHaveBeenCalledTimes(2);
		expect((await acquired.source.refresh()).tools[0]?.fingerprint).toBe("authenticated");

		await acquired.dispose();
		await manager.dispose();
	});
});

function managedSource(
	name: string,
	fingerprint: string,
	dispose = vi.fn(async () => undefined),
): ManagedMcpRuntimeToolSource {
	const binding: McpRuntimeToolBinding = {
		tool: {
			name,
			label: name,
			description: name,
			inputSchema: { type: "object", properties: {} },
			execute: async () => ({ content: [] }),
		},
		fingerprint,
	};
	return {
		source: { refresh: async () => ({ tools: [binding] }) },
		dispose,
	};
}
