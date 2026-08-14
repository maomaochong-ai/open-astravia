/**
 * 恢复的编排顺序：先封存现场，再写回，依赖变了才重装，最后重载画布。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesignSession } from "../src/vetd/design-session";

const commitHistory = vi.fn();
const restoreHistory = vi.fn();
const installDesignDependencies = vi.fn();
const calls: string[] = [];

vi.mock("../src/history/history-client", () => ({
	commitHistory: (...args: unknown[]) => {
		calls.push("stash");
		return commitHistory(...args);
	},
	restoreHistory: (...args: unknown[]) => {
		calls.push("restore");
		return restoreHistory(...args);
	},
}));
vi.mock("../src/engine/engine-manager", () => ({
	installDesignDependencies: (...args: unknown[]) => {
		calls.push("install");
		return installDesignDependencies(...args);
	},
}));

const { restoreDesign } = await import("../src/history/restore");

const ctx = {} as PluginContext;
const reload = vi.fn();
const session = { dirPath: "/w/a.vetd", reload } as unknown as DesignSession;

function commit(overrides: Partial<{ sha: string; title: string; files: string[] }> = {}) {
	return { sha: "new", title: "恢复到：初始设计", timestamp: 0, files: ["frames/login.tsx"], ...overrides };
}

beforeEach(() => {
	calls.length = 0;
	commitHistory.mockReset().mockResolvedValue(commit({ sha: "stashed", title: "恢复前的状态" }));
	restoreHistory.mockReset().mockResolvedValue(commit());
	installDesignDependencies.mockReset().mockResolvedValue("");
	reload.mockReset().mockResolvedValue(undefined);
});

const target = { sha: "old", title: "初始设计", timestamp: 0, files: [] };

describe("restoreDesign", () => {
	it("封存现场排在写回之前", async () => {
		await restoreDesign(ctx, session.dirPath, target, { session });
		// 顺序反了的话，被中断的那一轮改动会在写回时被覆盖掉，再也找不回来。
		expect(calls).toEqual(["stash", "restore"]);
		expect(commitHistory).toHaveBeenCalledWith(ctx, "/w/a.vetd", "恢复前的状态");
	});

	it("用目标版本的标题构造恢复提交", async () => {
		await restoreDesign(ctx, session.dirPath, target, { session });
		expect(restoreHistory).toHaveBeenCalledWith(ctx, "/w/a.vetd", "old", "恢复到：初始设计");
	});

	it("写回后重载画布——design.json 被整份换掉了，增量对账认不出来", async () => {
		await restoreDesign(ctx, session.dirPath, target, { session });
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("依赖清单变了要重装", async () => {
		restoreHistory.mockResolvedValue(commit({ files: ["package.json", "frames/login.tsx"] }));
		const outcome = await restoreDesign(ctx, session.dirPath, target, { session });
		expect(outcome.reinstalled).toBe(true);
		// 重装必须排在重载之前：先让 node_modules 对上清单，画布再去构建。
		expect(calls).toEqual(["stash", "restore", "install"]);
	});

	it("依赖没变就不动 node_modules", async () => {
		const outcome = await restoreDesign(ctx, session.dirPath, target, { session });
		expect(outcome.reinstalled).toBe(false);
		expect(installDesignDependencies).not.toHaveBeenCalled();
	});

	it("工作区本来就干净时没有封存版本", async () => {
		commitHistory.mockResolvedValue(null);
		const outcome = await restoreDesign(ctx, session.dirPath, target, { session });
		expect(outcome.stashed).toBeNull();
		expect(outcome.restored).not.toBeNull();
	});

	it("目标内容与当前一致时什么都没发生，也不重载", async () => {
		restoreHistory.mockResolvedValue(null);
		const outcome = await restoreDesign(ctx, session.dirPath, target, { session });
		expect(outcome.restored).toBeNull();
		expect(reload).not.toHaveBeenCalled();
	});
});
