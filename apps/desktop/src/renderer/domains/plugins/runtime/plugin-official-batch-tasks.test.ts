import { afterEach, describe, expect, it, vi } from "vitest";
import { createOfficialBatchTasksApi } from "./plugin-official-batch-tasks.js";

const project = {
	id: "C:/workspace/Batch",
	name: "Batch",
	prompt: "Process",
	concurrency: 2,
	tasks: [],
	createdAt: 1,
	updatedAt: 1,
};

afterEach(() => {
	Reflect.deleteProperty(globalThis, "window");
});

describe("createOfficialBatchTasksApi", () => {
	it("uses the plugin capability session and preserves facade transformations", async () => {
		const batchTasks = {
			listProjects: vi.fn().mockResolvedValue([project]),
			updateProject: vi.fn().mockResolvedValue(project),
			deleteTaskSession: vi.fn().mockResolvedValue({ status: "noop" }),
		};
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { vetta: { plugins: { internalCapabilities: { batchTasks } } } },
		});
		const assertOfficial = vi.fn();
		const api = createOfficialBatchTasksApi(assertOfficial, "capability-session");

		await expect(api.listProjectIds()).resolves.toEqual(["C:/workspace/Batch"]);
		await expect(api.updateProject("C:/workspace/Batch", { concurrency: 4 })).resolves.toEqual(project);
		await expect(api.deleteTaskSession("C:/workspace/Batch", "task")).resolves.toEqual({
			projectId: "C:/workspace/Batch",
			taskId: "task",
			operation: "delete-session",
			status: "noop",
		});

		expect(assertOfficial).toHaveBeenCalledTimes(3);
		expect(batchTasks.listProjects).toHaveBeenCalledWith("capability-session");
		expect(batchTasks.updateProject).toHaveBeenCalledWith("capability-session", "C:/workspace/Batch", {
			concurrency: 4,
		});
		expect(batchTasks.deleteTaskSession).toHaveBeenCalledWith("capability-session", "C:/workspace/Batch", "task");
	});
});
