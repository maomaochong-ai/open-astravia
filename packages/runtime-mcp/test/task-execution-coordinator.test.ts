import { describe, expect, it, vi } from "vitest";
import type {
	McpTaskClient,
	McpTaskExecutionSnapshot,
	McpTaskExecutionStore,
} from "../src/tasks/task-execution-coordinator.js";
import { McpTaskExecutionCoordinator } from "../src/tasks/task-execution-coordinator.js";
import { PRESERVE_MCP_TOOL_RESULT_POLICY } from "../src/tools/mcp-tool-result-policy.js";

const context = {
	sessionId: "session-1",
	turnId: "turn-1",
	toolCallId: "call-1",
	serverName: "fixture",
	toolName: "queued",
} as const;

const created = {
	resultType: "task" as const,
	taskId: "remote-secret-id",
	status: "working" as const,
	createdAt: "2026-08-30T00:00:00.000Z",
	lastUpdatedAt: "2026-08-30T00:00:00.000Z",
	ttlMs: 60_000,
};

describe("McpTaskExecutionCoordinator", () => {
	it("polls a created tool task, publishes progress and projects its final ToolResult", async () => {
		const store = memoryStore();
		const updates = vi.fn();
		const client: McpTaskClient = {
			waitForTask: vi.fn(async (_params, options) => {
				await options?.onStatus?.({
					...created,
					resultType: "complete",
					status: "input_required",
					lastUpdatedAt: "2026-08-30T00:00:01.000Z",
					inputRequests: { approval: { method: "elicitation/create" } },
				});
				const complete = {
					...created,
					resultType: "complete" as const,
					status: "completed" as const,
					lastUpdatedAt: "2026-08-30T00:00:02.000Z",
					result: { resultType: "complete", content: [{ type: "text", text: "done" }] },
				};
				await options?.onStatus?.(complete);
				return complete;
			}),
		};
		const coordinator = new McpTaskExecutionCoordinator({ store });

		await expect(
			coordinator.completeToolTask(client, created, {
				context,
				resultPolicy: PRESERVE_MCP_TOOL_RESULT_POLICY,
				onUpdate: updates,
			}),
		).resolves.toMatchObject({ content: [{ type: "text", text: "done" }] });
		expect(store.snapshots.map((snapshot) => snapshot.status)).toEqual(["working", "input_required", "completed"]);
		expect(updates).toHaveBeenCalledTimes(3);
		expect(JSON.stringify(updates.mock.calls)).not.toContain("remote-secret-id");
	});

	it("returns the raw final ToolResult for non-Agent hosts", async () => {
		const client: McpTaskClient = {
			waitForTask: async () => ({
				...created,
				resultType: "complete",
				status: "completed",
				lastUpdatedAt: "2026-08-30T00:00:02.000Z",
				result: {
					resultType: "complete",
					content: [{ type: "text", text: "app done" }],
					structuredContent: { view: "ready" },
				},
			}),
		};
		const coordinator = new McpTaskExecutionCoordinator();

		await expect(coordinator.waitForToolTaskResult(client, created, { context })).resolves.toMatchObject({
			content: [{ type: "text", text: "app done" }],
			structuredContent: { view: "ready" },
		});
	});

	it("cancels the remote Task when its owning Tool call is aborted", async () => {
		const controller = new AbortController();
		const cancelTask = vi.fn(async () => ({ resultType: "complete" as const }));
		const waitForTask: NonNullable<McpTaskClient["waitForTask"]> = vi.fn(
			(_params, options) =>
				new Promise<never>((_resolve, reject) => {
					if (options?.signal?.aborted) {
						reject(new DOMException("Task wait aborted", "AbortError"));
						return;
					}
					options?.signal?.addEventListener(
						"abort",
						() => reject(new DOMException("Task wait aborted", "AbortError")),
						{ once: true },
					);
				}),
		);
		const client: McpTaskClient = {
			cancelTask,
			waitForTask,
		};
		const coordinator = new McpTaskExecutionCoordinator();
		const pending = coordinator.completeToolTask(client, created, {
			context,
			resultPolicy: PRESERVE_MCP_TOOL_RESULT_POLICY,
			signal: controller.signal,
		});
		await vi.waitFor(() => expect(waitForTask).toHaveBeenCalledOnce());
		controller.abort();

		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(cancelTask).toHaveBeenCalledWith({ taskId: "remote-secret-id" });
	});

	it("recovers persisted non-terminal Tasks when their Server binding returns", async () => {
		const initial = snapshot("working");
		const store = memoryStore([initial]);
		const client: McpTaskClient = {
			waitForTask: vi.fn(async (_params, options) => {
				const terminal = {
					...created,
					resultType: "complete" as const,
					status: "cancelled" as const,
					lastUpdatedAt: "2026-08-30T00:00:03.000Z",
				};
				await options?.onStatus?.(terminal);
				return terminal;
			}),
		};
		const coordinator = new McpTaskExecutionCoordinator({ store });

		await coordinator.recover([{ view: { name: "fixture" }, client }]);
		await vi.waitFor(() => expect(store.snapshots.at(-1)).toMatchObject({ status: "cancelled", recovered: true }));
	});
});

function snapshot(status: McpTaskExecutionSnapshot["status"]): McpTaskExecutionSnapshot {
	return {
		id: "mcp-task-recovery-1",
		taskId: created.taskId,
		...context,
		status,
		createdAt: created.createdAt,
		lastUpdatedAt: created.lastUpdatedAt,
		ttlMs: created.ttlMs,
	};
}

function memoryStore(initial: readonly McpTaskExecutionSnapshot[] = []): McpTaskExecutionStore & {
	readonly snapshots: McpTaskExecutionSnapshot[];
} {
	const snapshots = [...initial];
	return {
		snapshots,
		list: async () => [...initial],
		upsert: async (value) => void snapshots.push(value),
	};
}
