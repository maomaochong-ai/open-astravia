import type * as FsPromises from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

const getProject = vi.hoisted(() =>
	vi.fn(async () => ({
		name: "Batch",
		tasks: [
			{
				id: "one",
				name: "Task",
				cwd: "C:/batch/item",
				sessionPath: "C:/sessions/task",
				executionMode: "sandbox",
				updatedAt: 123,
			},
			{ id: "empty", name: "Empty", cwd: "C:/batch/empty", updatedAt: 123 },
		],
	})),
);
vi.mock("../batch-tasks/batch-task-storage.js", () => ({ getProject }));
vi.mock("../config/desktop-config-store.js", () => ({
	DEFAULT_CONVERSATION_CWD: "C:/conversation",
	DEFAULT_CONVERSATION_SESSION_DIR: "C:/conversation/sessions",
	DEFAULT_IM_CONVERSATION_CWD: "C:/im",
	DEFAULT_IM_CONVERSATION_SESSION_DIR: "C:/im/sessions",
	KB_PROCESSING_CWD: "C:/knowledge",
	KB_PROCESSING_SESSION_DIR: "C:/knowledge/sessions",
	readDesktopConfig: async () => ({
		projects: [
			{ path: "C:/project", name: "Project" },
			{ path: "C:/batch", name: "Batch" },
		],
		archivedProjects: [{ path: "C:/archive" }],
	}),
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
	...(await importOriginal<typeof FsPromises>()),
	readFile: async (path: string) => JSON.stringify({ type: path.includes("batch") ? "batch" : "project" }),
}));

import { listDesktopSessionSearchSources } from "./session-search-sources.js";

describe("desktop session search sources", () => {
	it("uses registered sources only, preserving default buckets and batch working directories", async () => {
		const sources = await listDesktopSessionSearchSources();
		expect(sources.map(({ kind }) => kind)).toEqual(["conversation", "claw", "project", "batch"]);
		expect(sources[0]).toMatchObject({ cwd: "C:/conversation", sessionDir: "C:/conversation/sessions" });
		expect(sources.some(({ cwd }) => cwd === "C:/archive")).toBe(false);
		expect(sources[3].sessions).toHaveLength(1);
		expect(sources[3].sessions?.[0]).toMatchObject({ path: "C:/sessions/task", cwd: "C:/batch/item" });
		expect([...sources[3].executionModeByPath!.values()]).toEqual(["sandbox"]);
		expect(getProject).toHaveBeenCalledWith("C:/batch");
	});
});
