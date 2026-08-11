import { z } from "zod";
import type { BatchTaskService } from "../../batch-tasks/batch-task-service.js";
import type { SchedulerService } from "../../scheduler/scheduler-service.js";
import type { DebugDefinition, JsonValue } from "../types.js";
import { DebugError } from "../types.js";
import {
	RUNTIME_CANARY_BATCH_PROMPT,
	RUNTIME_CANARY_SCHEDULER_PROMPT,
	runtimeCanaryConsumersSchema,
} from "./contracts.js";

const inputSchema = z
	.object({
		workspace: z.string().min(1),
		modelKey: z.string().min(1),
		batchSourceDirectories: z.tuple([z.string().min(1), z.string().min(1)]),
	})
	.strict();

export interface RuntimeCanarySchedulerState {
	readonly activeTasks: Array<{
		readonly taskId: string;
		readonly sessionId: string;
		readonly sessionPath: string | undefined;
	}>;
}

export interface RuntimeCanaryBatchState {
	readonly activeTasks: Array<{
		readonly projectId: string;
		readonly taskId: string;
		readonly sessionId: string;
		readonly sessionPath: string | undefined;
	}>;
	readonly queuedTaskIds: string[];
}

export interface RuntimeCanaryConsumerDependencies {
	readonly scheduler: Pick<SchedulerService, "createTask" | "runNow">;
	readonly batch: Pick<BatchTaskService, "createProject" | "startProject">;
	readonly readSchedulerState: () => RuntimeCanarySchedulerState;
	readonly readBatchState: () => RuntimeCanaryBatchState;
}

function validateInput(input: unknown): JsonValue {
	const result = inputSchema.safeParse(input);
	if (!result.success) {
		throw new DebugError("DEBUG_INVALID_INPUT", "runtime-canary.consumers.start input is invalid.", {
			issues: result.error.issues.map((issue) => ({
				path: issue.path.join("."),
				message: issue.message,
			})),
		});
	}
	return result.data;
}

export function createRuntimeCanaryConsumerDefinitions(
	dependencies: RuntimeCanaryConsumerDependencies,
): DebugDefinition[] {
	let started = false;
	return [
		{
			id: "runtime-canary.consumers.start",
			category: "runtime-canary",
			title: "Start Runtime Canary background consumers",
			summary:
				"Start one Scheduler task and two concurrency-limited Batch tasks in the development Desktop process.",
			keywords: ["runtime", "canary", "scheduler", "batch", "shutdown"],
			inputSchema: {
				description: "Isolated Runtime Canary workspace, model key, and two Batch source directories.",
			},
			examples: [],
			validateInput,
			run: async (input) => {
				if (started) {
					throw new DebugError(
						"RUNTIME_CANARY_ALREADY_STARTED",
						"Runtime Canary background consumers have already started.",
					);
				}
				started = true;
				const parsed = inputSchema.parse(input);
				let schedulerFailure: unknown;
				const schedulerTask = await dependencies.scheduler.createTask({
					name: "Runtime Canary Scheduler",
					prompt: RUNTIME_CANARY_SCHEDULER_PROMPT,
					cron: "0 0 1 1 *",
					isOnce: false,
					enabled: false,
					cwd: parsed.workspace,
					modelKey: parsed.modelKey,
					executionMode: "full-access",
				});
				void dependencies.scheduler.runNow(schedulerTask.id).catch((error: unknown) => {
					schedulerFailure = error;
				});

				const batchProject = await dependencies.batch.createProject({
					name: "Runtime Canary Batch",
					prompt: RUNTIME_CANARY_BATCH_PROMPT,
					modelKey: parsed.modelKey,
					folders: parsed.batchSourceDirectories,
					concurrency: 1,
					executionMode: "full-access",
					notifyEnabled: false,
				});
				await dependencies.batch.startProject(batchProject.id);

				const state = await waitForConsumerState(
					dependencies.readSchedulerState,
					dependencies.readBatchState,
					() => schedulerFailure,
					10_000,
				);
				const schedulerActive = state.scheduler.activeTasks.find(
					(candidate) => candidate.taskId === schedulerTask.id,
				);
				const batchActive = state.batch.activeTasks.find((candidate) => candidate.projectId === batchProject.id);
				const batchQueuedTaskId = state.batch.queuedTaskIds.find((taskId) => taskId !== batchActive?.taskId);
				return runtimeCanaryConsumersSchema.parse({
					schedulerTaskId: schedulerTask.id,
					schedulerSessionId: schedulerActive?.sessionId,
					schedulerSessionPath: schedulerActive?.sessionPath,
					batchProjectId: batchProject.id,
					batchActiveTaskId: batchActive?.taskId,
					batchQueuedTaskId,
					batchSessionId: batchActive?.sessionId,
					batchSessionPath: batchActive?.sessionPath,
				});
			},
		},
	];
}

async function waitForConsumerState(
	readSchedulerState: () => RuntimeCanarySchedulerState,
	readBatchState: () => RuntimeCanaryBatchState,
	readSchedulerFailure: () => unknown,
	timeoutMs: number,
): Promise<{ scheduler: RuntimeCanarySchedulerState; batch: RuntimeCanaryBatchState }> {
	const startedAt = Date.now();
	while (true) {
		const failure = readSchedulerFailure();
		if (failure) throw failure;
		const scheduler = readSchedulerState();
		const batch = readBatchState();
		if (
			scheduler.activeTasks.some((task) => Boolean(task.sessionPath)) &&
			batch.activeTasks.some((task) => Boolean(task.sessionPath)) &&
			batch.queuedTaskIds.length > 0
		) {
			return { scheduler, batch };
		}
		if (Date.now() - startedAt >= timeoutMs) {
			throw new Error("Timed out waiting for Runtime Canary background consumers");
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}
