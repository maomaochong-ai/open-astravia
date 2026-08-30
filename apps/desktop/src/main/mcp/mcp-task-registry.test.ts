import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpTaskExecutionSnapshot } from "@vetta/runtime-mcp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopMcpTaskRegistry } from "./mcp-task-registry.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) {
		await rm(directory, { recursive: true, force: true });
	}
});

describe("DesktopMcpTaskRegistry", () => {
	it("atomically persists minimized Task state and restores it after restart", async () => {
		const filePath = await temporaryStatePath();
		const registry = new DesktopMcpTaskRegistry({ filePath });
		const changed = vi.fn();
		registry.onChanged(changed);
		await registry.upsert(snapshot("working", "2026-08-30T00:00:01.000Z"));

		expect(await registry.listPublic("session-1")).toEqual([
			expect.objectContaining({
				id: expect.any(String),
				sessionId: "session-1",
				serverName: "fixture",
				toolName: "queued",
				status: "working",
			}),
		]);
		expect(JSON.stringify(changed.mock.calls)).not.toContain('"taskId"');
		const persisted = JSON.parse(await readFile(filePath, "utf8")) as { tasks: unknown[] };
		expect(persisted.tasks).toHaveLength(1);
		expect(JSON.stringify(persisted)).not.toContain("inputRequests");
		expect(JSON.stringify(persisted)).not.toContain("result");

		const restored = new DesktopMcpTaskRegistry({ filePath });
		expect(await restored.list()).toEqual([expect.objectContaining({ taskId: "remote-task-1", status: "working" })]);
	});

	it("clears terminal records per session and tolerates corrupt recovery state", async () => {
		const filePath = await temporaryStatePath();
		const registry = new DesktopMcpTaskRegistry({ filePath });
		await registry.upsert(snapshot("completed", "2026-08-30T00:00:02.000Z"));
		await registry.upsert(snapshot("working", "2026-08-30T00:00:04.000Z"));
		await registry.upsert({
			...snapshot("failed", "2026-08-30T00:00:03.000Z"),
			id: "mcp-task-test-2",
			sessionId: "session-2",
		});

		expect(await registry.listPublic("session-1")).toEqual([expect.objectContaining({ status: "completed" })]);
		await expect(registry.clearTerminal("session-1")).resolves.toBe(1);
		expect(await registry.listPublic()).toEqual([expect.objectContaining({ sessionId: "session-2" })]);

		const corruptPath = join(temporaryDirectories[0] ?? tmpdir(), "corrupt.json");
		await writeFile(corruptPath, "{ invalid", "utf8");
		await expect(new DesktopMcpTaskRegistry({ filePath: corruptPath }).list()).resolves.toEqual([]);
	});
});

async function temporaryStatePath(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "vetta-mcp-task-test-"));
	temporaryDirectories.push(directory);
	return join(directory, "state.json");
}

function snapshot(status: McpTaskExecutionSnapshot["status"], lastUpdatedAt: string): McpTaskExecutionSnapshot {
	return {
		id: "mcp-task-test-1",
		taskId: "remote-task-1",
		sessionId: "session-1",
		turnId: "turn-1",
		toolCallId: "call-1",
		serverName: "fixture",
		toolName: "queued",
		status,
		statusMessage: "still working",
		createdAt: "2026-08-30T00:00:00.000Z",
		lastUpdatedAt,
		ttlMs: null,
	};
}
