import { describe, expect, it, type Mock, vi } from "vitest";
import { DEFAULT_CONVERSATION_CWD } from "../config/desktop-config-store.js";
import {
	isProtectedProjectCwd,
	type ProjectSessionPurgeDependencies,
	purgeProjectSessions,
} from "./project-session-purge.js";

interface TestDependencies extends ProjectSessionPurgeDependencies {
	readonly deleteSession: Mock<(sessionPath: string) => Promise<void>>;
	readonly removeDirectory: Mock<(dir: string) => Promise<void>>;
}

function createDependencies(
	overrides: Partial<ProjectSessionPurgeDependencies> & {
		readonly deleteSession?: TestDependencies["deleteSession"];
	} = {},
): TestDependencies {
	const { deleteSession, ...rest } = overrides;
	return {
		listSessions: async () => [],
		resolveSessionDirs: (cwd) => [`/shard/${cwd}`],
		logError: () => {},
		...rest,
		deleteSession: deleteSession ?? vi.fn(async () => {}),
		removeDirectory: vi.fn(async () => {}),
	};
}

describe("purgeProjectSessions", () => {
	it("删掉该 cwd 名下全部会话，并回收会话目录", async () => {
		const dependencies = createDependencies({
			listSessions: async () => [{ path: "/shard/a.conversation.jsonl" }, { path: "/shard/b.conversation.jsonl" }],
		});

		const result = await purgeProjectSessions("/Users/me/.vetta/workspace/aaa", dependencies);

		expect(result).toEqual({ deleted: 2, failed: [] });
		expect(dependencies.deleteSession.mock.calls.map(([path]) => path)).toEqual([
			"/shard/a.conversation.jsonl",
			"/shard/b.conversation.jsonl",
		]);
		expect(dependencies.removeDirectory).toHaveBeenCalledWith("/shard//Users/me/.vetta/workspace/aaa");
	});

	it("单条删除失败不阻断其余会话，但保留会话目录", async () => {
		const deleteSession = vi.fn(async (path: string) => {
			if (path === "/shard/b.conversation.jsonl") throw new Error("locked");
		});
		const dependencies = createDependencies({
			listSessions: async () => [
				{ path: "/shard/a.conversation.jsonl" },
				{ path: "/shard/b.conversation.jsonl" },
				{ path: "/shard/c.conversation.jsonl" },
			],
			deleteSession,
		});

		const result = await purgeProjectSessions("/Users/me/.vetta/workspace/aaa", dependencies);

		expect(result.deleted).toBe(2);
		expect(result.failed).toEqual(["/shard/b.conversation.jsonl"]);
		expect(deleteSession).toHaveBeenCalledTimes(3);
		expect(dependencies.removeDirectory).not.toHaveBeenCalled();
	});

	it("拒绝清理内置「对话」cwd", async () => {
		const dependencies = createDependencies();
		await expect(purgeProjectSessions(DEFAULT_CONVERSATION_CWD, dependencies)).rejects.toThrow(
			/built-in conversation cwd/,
		);
		expect(dependencies.deleteSession).not.toHaveBeenCalled();
	});

	it("内置 cwd 判定不受结尾斜杠影响", () => {
		expect(isProtectedProjectCwd(`${DEFAULT_CONVERSATION_CWD}/`)).toBe(true);
		expect(isProtectedProjectCwd("/Users/me/.vetta/workspace/aaa")).toBe(false);
	});
});
