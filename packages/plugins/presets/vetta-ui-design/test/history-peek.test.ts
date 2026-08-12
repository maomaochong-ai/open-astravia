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
		const request = args[1] as { cmd: string };
		order.push(request.cmd);
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
	if (path.endsWith("/design.json")) return { content: '{"frames":[]}' };
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

/** 当前未提交的改动，逐用例改。 */
let changed: string[] = [];

const head = { sha: "head", title: "最新", timestamp: 0, files: [] };
const target = { sha: "old", title: "初始状态", timestamp: 0, files: [] };

beforeEach(() => {
	files.clear();
	order.length = 0;
	changed = ["frames/login.tsx"];
	commitHistory.mockReset().mockResolvedValue(null);
	listHistory.mockReset().mockResolvedValue([head]);
	runHistoryCommand.mockReset().mockImplementation((_ctx: unknown, request: { cmd: string }) =>
		request.cmd === "status" ? Promise.resolve({ changed }) : Promise.resolve({ checkedOut: "x" }),
	);
	reload.mockReset().mockResolvedValue(undefined);
	writeFile.mockClear();
	remove.mockClear();
});

describe("enterPeek", () => {
	it("先封存现场，再写标记，最后才切内容", async () => {
		await enterPeek(ctx, session, target);
		// 顺序错一步就丢东西：没封存就切，未提交的改动被旧版本盖掉；
		// 先切后写标记，中间崩溃就没人知道该退回哪一版。
		expect(order).toEqual(["status", "commit", "marker-write", "checkout"]);
	});

	it("标记里记着要退回哪一版", async () => {
		const state = await enterPeek(ctx, session, target);
		expect(state).toMatchObject({ sha: "old", title: "初始状态", returnTo: "head" });
		expect(await readPeekState(ctx, "/w/a.vetd")).toEqual(state);
	});

	it("只有 design.json 变了不落版本——那是拖画框/平移视口，不值得占一条历史", async () => {
		changed = ["design.json"];
		await enterPeek(ctx, session, target);
		expect(commitHistory).not.toHaveBeenCalled();
		// 但它的内容要存进标记，退出时写回，否则拖过的画框会弹回旧位置。
		expect(await readPeekState(ctx, "/w/a.vetd")).toMatchObject({ manifest: expect.any(String) });
	});

	it("工作区干净时既不提交也不存 manifest", async () => {
		changed = [];
		await enterPeek(ctx, session, target);
		expect(commitHistory).not.toHaveBeenCalled();
		expect((await readPeekState(ctx, "/w/a.vetd"))?.manifest).toBeUndefined();
	});

	it("已经在查看态时再点查看：换一版看，绝不再封存现场", async () => {
		const first = await enterPeek(ctx, session, target);
		commitHistory.mockClear();
		const second = await enterPeek(ctx, session, { sha: "older", title: "更早" });
		// 现场此刻装的是上一版旧内容，再封存就是把旧内容记成新版本（实测踩过：
		// 连点五次「查看」，历史里多出五个一模一样的假版本）。
		expect(commitHistory).not.toHaveBeenCalled();
		expect(second).toMatchObject({ sha: "older", returnTo: first?.returnTo });
	});

	it("点当前正在查看的那一版，原样返回", async () => {
		const first = await enterPeek(ctx, session, target);
		expect(await enterPeek(ctx, session, target)).toEqual(first);
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
