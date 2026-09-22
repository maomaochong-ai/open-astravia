import { afterEach, describe, expect, it, vi } from "vitest";
import { createOfficialSchedulerApi } from "./plugin-official-scheduler.js";

const task = {
	id: "task",
	name: "Daily",
	prompt: "Run",
	schedule: { kind: "daily" as const, hour: 9, minute: 0 },
	runTarget: { mode: "new-session" as const, projectCwd: "C:/workspace" },
	enabled: true,
	createdAt: 1,
	updatedAt: 1,
	lastRunAt: null,
	lastRunStatus: null,
};

afterEach(() => {
	Reflect.deleteProperty(globalThis, "window");
});

describe("createOfficialSchedulerApi", () => {
	it("uses the plugin capability session and forwards explicit clears unchanged", async () => {
		const scheduler = {
			listTasks: vi.fn().mockResolvedValue([task]),
			updateTask: vi.fn().mockResolvedValue(task),
		};
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { vetta: { plugins: { internalCapabilities: { scheduler } } } },
		});
		const assertOfficial = vi.fn();
		const api = createOfficialSchedulerApi(assertOfficial, "capability-session");

		await expect(api.listTaskIds()).resolves.toEqual(["task"]);
		await expect(api.updateTask("task", { model: null, notification: null })).resolves.toEqual(task);

		expect(assertOfficial).toHaveBeenCalledTimes(2);
		expect(scheduler.listTasks).toHaveBeenCalledWith("capability-session");
		expect(scheduler.updateTask).toHaveBeenCalledWith("capability-session", "task", {
			model: null,
			notification: null,
		});
	});
});
