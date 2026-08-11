import { describe, expect, it, vi } from "vitest";
import { createRuntimeCanaryConsumerDefinitions } from "./consumer-definitions.js";
import { RUNTIME_CANARY_BATCH_PROMPT, RUNTIME_CANARY_SCHEDULER_PROMPT } from "./contracts.js";

describe("Runtime Canary consumer definitions", () => {
	it("starts Scheduler and concurrency-limited Batch consumers through their services", async () => {
		const createTask = vi.fn(async () => ({
			id: "scheduler-task",
			name: "Runtime Canary Scheduler",
			prompt: RUNTIME_CANARY_SCHEDULER_PROMPT,
			cron: "0 0 1 1 *",
			isOnce: false,
			enabled: false,
			cwd: "C:/runtime-canary",
			createdAt: 1,
			updatedAt: 1,
			lastRunAt: null,
			lastRunStatus: null,
		}));
		const runNow = vi.fn(async () => ({ status: "accepted" as const, taskId: "scheduler-task" }));
		const createProject = vi.fn(async () => ({
			id: "batch-project",
			name: "Runtime Canary Batch",
			prompt: RUNTIME_CANARY_BATCH_PROMPT,
			concurrency: 1,
			tasks: [],
			createdAt: 1,
			updatedAt: 1,
		}));
		const startProject = vi.fn(async () => ({
			status: "accepted" as const,
			projectId: "batch-project",
			affectedTaskIds: ["batch-active", "batch-queued"],
			queuedTaskIds: ["batch-queued"],
		}));
		const [definition] = createRuntimeCanaryConsumerDefinitions({
			scheduler: { createTask, runNow },
			batch: { createProject, startProject },
			readSchedulerState: () => ({
				acceptingExecutions: true,
				shutdownStarted: false,
				activeTasks: [
					{
						taskId: "scheduler-task",
						sessionId: "scheduler-session",
						sessionPath: "C:/sessions/scheduler.jsonl",
					},
				],
			}),
			readBatchState: () => ({
				acceptingJobs: true,
				shutdownStarted: false,
				activeTasks: [
					{
						projectId: "batch-project",
						taskId: "batch-active",
						sessionId: "batch-session",
						sessionPath: "C:/sessions/batch.jsonl",
					},
				],
				queuedTaskIds: ["batch-queued"],
			}),
		});

		const result = await definition.run(
			definition.validateInput({
				workspace: "C:/runtime-canary",
				modelKey: "runtime-canary/runtime-canary-model",
				batchSourceDirectories: ["C:/source-one", "C:/source-two"],
			}),
			{ source: "local-server" },
		);

		expect(result).toMatchObject({
			schedulerTaskId: "scheduler-task",
			schedulerSessionId: "scheduler-session",
			batchProjectId: "batch-project",
			batchActiveTaskId: "batch-active",
			batchQueuedTaskId: "batch-queued",
			batchSessionId: "batch-session",
		});
		expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ prompt: RUNTIME_CANARY_SCHEDULER_PROMPT }));
		expect(createProject).toHaveBeenCalledWith(expect.objectContaining({ prompt: RUNTIME_CANARY_BATCH_PROMPT }));
		expect(runNow).toHaveBeenCalledWith("scheduler-task");
		expect(startProject).toHaveBeenCalledWith("batch-project");
	});

	it("rejects non-isolated or repeated start input", async () => {
		const [definition] = createRuntimeCanaryConsumerDefinitions({
			scheduler: {
				createTask: vi.fn(),
				runNow: vi.fn(),
			},
			batch: {
				createProject: vi.fn(),
				startProject: vi.fn(),
			},
			readSchedulerState: () => ({ activeTasks: [] }),
			readBatchState: () => ({ activeTasks: [], queuedTaskIds: [] }),
		});

		expect(() => definition.validateInput({ workspace: "C:/runtime-canary" })).toThrowError(
			"runtime-canary.consumers.start input is invalid",
		);
	});
});
