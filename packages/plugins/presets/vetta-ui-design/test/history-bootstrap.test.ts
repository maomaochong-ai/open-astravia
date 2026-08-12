/**
 * 打开设计时接上历史的编排逻辑。runner 与文件系统都在边界上换掉——这里验证的是
 * 「什么时候该落基础版本、失败了会不会连累打开设计」，不是 git 本身。
 */
import type { PluginContext, PluginFsApi } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureHistory = vi.fn();
const commitHistory = vi.fn();
const ensureDesignIgnored = vi.fn();
const exitPeek = vi.fn();

vi.mock("../src/history/history-client", () => ({
	ensureHistory: (...args: unknown[]) => ensureHistory(...args),
	commitHistory: (...args: unknown[]) => commitHistory(...args),
}));
vi.mock("../src/vetd/design-ignore", () => ({
	ensureDesignIgnored: (...args: unknown[]) => ensureDesignIgnored(...args),
}));
vi.mock("../src/history/peek", () => ({ exitPeek: (...args: unknown[]) => exitPeek(...args) }));

const { bootstrapHistory, resetHistoryBootstrap } = await import("../src/history/history-bootstrap");

const ctx = { fs: {} as PluginFsApi } as PluginContext;

/** bootstrap 只用到 dirPath（以及自愈时的 reload，由 exitPeek 内部处理）。 */
function sessionAt(dirPath: string) {
	return { dirPath } as unknown as import("../src/vetd/design-session").DesignSession;
}

beforeEach(() => {
	resetHistoryBootstrap();
	ensureHistory.mockReset().mockResolvedValue({ hasCommits: false });
	commitHistory.mockReset().mockResolvedValue({ sha: "abc", title: "初始状态", timestamp: 0, files: [] });
	ensureDesignIgnored.mockReset().mockResolvedValue(undefined);
	exitPeek.mockReset().mockResolvedValue(false);
});

describe("bootstrapHistory", () => {
	it("没有历史的老设计先补 .gitignore 再落基础版本", async () => {
		await bootstrapHistory(ctx, sessionAt("/w/login.vetd"));
		expect(ensureDesignIgnored).toHaveBeenCalledWith(ctx.fs, "/w/login.vetd");
		expect(commitHistory).toHaveBeenCalledWith(ctx, "/w/login.vetd", "初始状态");
	});

	it("已经有历史的设计不再落基础版本", async () => {
		ensureHistory.mockResolvedValue({ hasCommits: true });
		await bootstrapHistory(ctx, sessionAt("/w/login.vetd"));
		expect(commitHistory).not.toHaveBeenCalled();
	});

	it("同一个设计反复打开只初始化一次", async () => {
		await Promise.all([
			bootstrapHistory(ctx, sessionAt("/w/login.vetd")),
			bootstrapHistory(ctx, sessionAt("/w/login.vetd")),
			bootstrapHistory(ctx, sessionAt("/w/login.vetd")),
		]);
		expect(ensureHistory).toHaveBeenCalledTimes(1);
	});

	it("不同设计各自初始化", async () => {
		await bootstrapHistory(ctx, sessionAt("/w/a.vetd"));
		await bootstrapHistory(ctx, sessionAt("/w/b.vetd"));
		expect(ensureHistory).toHaveBeenCalledTimes(2);
	});

	it("上次查看旧版本时崩溃了，打开设计先退回最新版", async () => {
		await bootstrapHistory(ctx, sessionAt("/w/login.vetd"));
		// 不自愈的话，用户会以为自己的设计被改回去了——工作区里装的是那一版旧内容。
		expect(exitPeek).toHaveBeenCalledTimes(1);
	});

	it("历史不可用时不抛出——设计照常打开，下次再试", async () => {
		ensureHistory.mockRejectedValue(new Error("node 挂了"));
		await expect(bootstrapHistory(ctx, sessionAt("/w/login.vetd"))).resolves.toBeUndefined();
		// 失败不该被记成「已初始化」，否则这个会话内再也不会重试。
		ensureHistory.mockResolvedValue({ hasCommits: true });
		await bootstrapHistory(ctx, sessionAt("/w/login.vetd"));
		expect(ensureHistory).toHaveBeenCalledTimes(2);
	});
});
