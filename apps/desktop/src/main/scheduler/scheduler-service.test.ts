import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledTask } from "../../shared/automation.js";

const stored = vi.hoisted(() => ({ tasks: [] as ScheduledTask[] }));

vi.mock("../app-monitor/app-monitor-service.js", () => ({ recordAutomationTaskCreated: vi.fn() }));
vi.mock("./task-executor.js", () => ({
	abortTask: vi.fn(),
	AutomationAlreadyRunningError: class extends Error {},
	executeTask: vi.fn(),
	isTaskRunning: () => false,
}));
vi.mock("./task-storage.js", () => ({
	deleteRecordsBySessionPaths: vi.fn(async () => []),
	deleteTaskRecords: vi.fn(),
	generateId: () => "task-1",
	loadAutomationSessionLinks: vi.fn(async () => []),
	loadRecords: vi.fn(async () => []),
	loadTasks: async () => stored.tasks,
	mutateTasks: async <T>(mutate: (tasks: ScheduledTask[]) => T) => mutate(stored.tasks),
}));

import { SchedulerService } from "./scheduler-service.js";

function service() {
	return new SchedulerService({
		getRuntime: vi.fn(),
		syncTask: vi.fn(),
		unscheduleTask: vi.fn(),
		isKnownProject: async () => true,
		sameProjectPath: (a, b) => a === b,
		conversationCwd: "C:/home/.vetta/conversation",
	});
}

describe("SchedulerService", () => {
	beforeEach(() => {
		stored.tasks = [];
	});

	it("puts automations without a project into the default conversation", async () => {
		const task = await service().createTask({
			name: "Daily",
			prompt: "Summarize",
			schedule: { kind: "daily", hour: 9, minute: 0 },
			runTarget: { mode: "same-session", sessionPath: null },
			enabled: true,
		});

		expect(task.runTarget).toEqual({
			mode: "same-session",
			projectCwd: "C:/home/.vetta/conversation",
			sessionPath: null,
		});
	});

	it("clears a suspension once the target changes and keeps explicit projects as given", async () => {
		stored.tasks = [
			{
				id: "task-1",
				name: "Daily",
				prompt: "Summarize",
				schedule: { kind: "daily", hour: 9, minute: 0 },
				runTarget: { mode: "new-session", projectCwd: "C:/gone" },
				enabled: false,
				suspendedReason: "project-removed",
				createdAt: 1,
				updatedAt: 1,
				lastRunAt: null,
				lastRunStatus: null,
			},
		];

		const task = await service().updateTask("task-1", { runTarget: { mode: "new-session", projectCwd: "C:/repo" } });

		expect(task.runTarget).toEqual({ mode: "new-session", projectCwd: "C:/repo" });
		expect(task.suspendedReason).toBeUndefined();
	});
});
