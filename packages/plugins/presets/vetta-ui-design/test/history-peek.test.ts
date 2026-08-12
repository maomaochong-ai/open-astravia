/**
 * 查看模式的三道闸：进入前封存现场、标记先写后切、退出写回进入时的那一版。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesignSession } from "../src/vetd/design-session";

const commitHistory = vi.fn();
const listHistory = vi.fn();
const runHistoryCommand = vi.fn();
const order: string[] = [];

vi.mock("../src/history/history-client", () => ({
	commitHistory: (...args: unknown[]) => {
		order.push("commit");
		return commitHistory(...args);
	},
	listHistory: (...args: unknown[]) => listHistory(...args),
}));
vi.mock("../src/history/runner-host", () => ({
	runHistoryCommand: (...args: unknown[]) => {
		order.push("checkout");
		return runHistoryCommand(...args);
	},
}));

const { enterPeek, exitPeek, readPeekState } = await import("../src/history/peek");

const files = new Map<string, string>();
const writeFile = vi.fn(async (path: string, content: string) => {
	order.push("marker-write");
	files.set(path, content);
});
const readFile = vi.fn(async (path: string) => {
	const content = files.get(path);
	if (content === undefined) throw new Error("ENOENT");
	return { content };
});
const remove = vi.fn(async (path: string) => {
	order.push("marker-delete");
	files.delete(path);
});

const ctx = { fs: { writeFile, readFile, delete: remove } } as unknown as PluginContext;
const reload = vi.fn();
const session = { dirPath: "/w/a.vetd", reload } as unknown as DesignSession;
const MARKER = "/w/a.vetd/.history/peek.json";

const head = { sha: "head", title: "最新", timestamp: 0, files: [] };
const target = { sha: "old", title: "初始状态", timestamp: 0, files: [] };

beforeEach(() => {
	files.clear();
	order.length = 0;
	commitHistory.mockReset().mockResolvedValue(null);
	listHistory.mockReset().mockResolvedValue([head]);
	runHistoryCommand.mockReset().mockResolvedValue({ checkedOut: "x" });
	reload.mockReset().mockResolvedValue(undefined);
	writeFile.mockClear();
	remove.mockClear();
});

describe("enterPeek", () => {
	it("先封存现场，再写标记，最后才切内容", async () => {
		await enterPeek(ctx, session, target);
		// 顺序错一步就丢东西：没封存就切，未提交的改动被旧版本盖掉；
		// 先切后写标记，中间崩溃就没人知道该退回哪一版。
		expect(order).toEqual(["commit", "marker-write", "checkout"]);
	});

	it("标记里记着要退回哪一版", async () => {
		const state = await enterPeek(ctx, session, target);
		expect(state).toEqual({ sha: "old", title: "初始状态", returnTo: "head" });
		expect(await readPeekState(ctx, "/w/a.vetd")).toEqual(state);
	});

	it("切完重载画布——design.json 也被换掉了", async () => {
		await enterPeek(ctx, session, target);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("目标就是当前版本时不进入", async () => {
		expect(await enterPeek(ctx, session, head)).toBeNull();
		expect(files.has(MARKER)).toBe(false);
	});

	it("历史为空时不进入", async () => {
		listHistory.mockResolvedValue([]);
		expect(await enterPeek(ctx, session, target)).toBeNull();
	});
});

describe("exitPeek", () => {
	it("写回进入时的那一版，再删标记", async () => {
		await enterPeek(ctx, session, target);
		order.length = 0;
		expect(await exitPeek(ctx, session)).toBe(true);
		expect(runHistoryCommand).toHaveBeenLastCalledWith(ctx, { cmd: "checkout", dir: "/w/a.vetd", sha: "head" });
		// 删标记必须在写回之后：反过来时中间崩溃会留下一个内容是旧版、却没人知道
		// 要退回的设计。
		expect(order).toEqual(["checkout", "marker-delete"]);
		expect(files.has(MARKER)).toBe(false);
	});

	it("没在查看时什么都不做", async () => {
		expect(await exitPeek(ctx, session)).toBe(false);
		expect(runHistoryCommand).not.toHaveBeenCalled();
	});

	it("退出不提交——查看不该在历史里留痕迹", async () => {
		await enterPeek(ctx, session, target);
		commitHistory.mockClear();
		await exitPeek(ctx, session);
		expect(commitHistory).not.toHaveBeenCalled();
	});
});

describe("查看期间的自动提交", () => {
	it("被跳过——否则回合结束会把旧版本记成新版本", async () => {
		vi.resetModules();
		const readPeek = vi.fn().mockResolvedValue({ sha: "old", title: "x", returnTo: "head" });
		vi.doMock("../src/history/peek", () => ({ readPeekState: readPeek }));
		const turnCommit = vi.fn();
		vi.doMock("../src/history/history-client", () => ({ commitHistory: turnCommit }));
		vi.doMock("../src/canvas/design-runtime", () => ({ getCanvasController: () => null }));

		const { commitTurn } = await import("../src/history/turn-history");
		const listFilesRecursive = async () => [
			{ name: "design.json", path: "/w/a.vetd/design.json", relPath: "a.vetd/design.json" },
		];
		await commitTurn({ fs: { listFilesRecursive } } as unknown as PluginContext, "/w", "改了点东西");

		expect(readPeek).toHaveBeenCalled();
		expect(turnCommit).not.toHaveBeenCalled();
	});
});
