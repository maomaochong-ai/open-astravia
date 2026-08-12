/**
 * 回合提交的编排：什么时候提交、用什么标题、失败了会不会连累别的设计。
 * git 与画布都在边界上换掉——这里验证的是接线，不是 git。
 */
import type { PluginContext, PluginFsApi } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const commitHistory = vi.fn();

vi.mock("../src/history/history-client", () => ({
	commitHistory: (...args: unknown[]) => commitHistory(...args),
}));

const { commitTurn, registerTurnHistory, resetTurnHistory } = await import("../src/history/turn-history");

let files: { name: string; path: string; relPath: string }[] = [];

function makeCtx(): PluginContext {
	return {
		fs: { listFilesRecursive: async () => files } as unknown as PluginFsApi,
		agent: { registerHook: vi.fn((registration: unknown) => ({ dispose: vi.fn(), registration })) },
	} as unknown as PluginContext;
}

/** 递归列举只回文件，设计包这个目录靠里面的 design.json 反推（见 discover.ts）。 */
function designFiles(...dirs: string[]) {
	return dirs.flatMap((dir) => [
		{ name: "design.json", path: `/w/${dir}/design.json`, relPath: `${dir}/design.json` },
		{ name: "login.tsx", path: `/w/${dir}/frames/login.tsx`, relPath: `${dir}/frames/login.tsx` },
	]);
}

beforeEach(() => {
	resetTurnHistory();
	files = designFiles("a.vetd");
	commitHistory.mockReset().mockResolvedValue({ sha: "s1", title: "t", timestamp: 0, files: ["frames/login.tsx"] });
});

describe("commitTurn", () => {
	it("给 cwd 下每一份设计各落一个版本", async () => {
		files = designFiles("a.vetd", "b.vetd");
		await commitTurn(makeCtx(), "/w", "改导航栏");
		expect(commitHistory.mock.calls.map((call) => call[1])).toEqual(["/w/a.vetd", "/w/b.vetd"]);
		expect(commitHistory.mock.calls[0]?.[2]).toBe("改导航栏");
	});

	it("没有设计时什么都不做", async () => {
		files = [];
		await commitTurn(makeCtx(), "/w", "改导航栏");
		expect(commitHistory).not.toHaveBeenCalled();
	});

	it("没有变更时不产生版本", async () => {
		commitHistory.mockResolvedValue(null);
		await commitTurn(makeCtx(), "/w", "什么都没改");
		expect(commitHistory).toHaveBeenCalledTimes(1);
	});

	it("一份设计失败不连累其它设计，也不抛出", async () => {
		files = designFiles("a.vetd", "b.vetd");
		commitHistory.mockRejectedValueOnce(new Error("runner 挂了"));
		await expect(commitTurn(makeCtx(), "/w", "改导航栏")).resolves.toBeUndefined();
		expect(commitHistory).toHaveBeenCalledTimes(2);
	});
});

describe("hook 接线", () => {
	interface Registration {
		eventName: string;
		agent_mode?: readonly string[];
		handler: (context: { session: { id: string; cwd: string }; event: { prompt?: string } }) => Promise<void>;
	}

	function registered(ctx: PluginContext): Map<string, Registration> {
		registerTurnHistory(ctx);
		const calls = (ctx.agent.registerHook as unknown as { mock: { calls: [Registration][] } }).mock.calls;
		return new Map(calls.map(([registration]) => [registration.eventName, registration]));
	}

	it("只在工作模式生效", () => {
		for (const registration of registered(makeCtx()).values()) {
			expect(registration.agent_mode).toEqual(["work"]);
		}
	});

	it("Stop 用这一轮用户那句话当标题", async () => {
		const ctx = makeCtx();
		const hooks = registered(ctx);
		const session = { id: "s", cwd: "/w" };
		await hooks.get("UserPromptSubmit")?.handler({ session, event: { prompt: "把导航栏改到左侧\n再说" } });
		await hooks.get("Stop")?.handler({ session, event: {} });
		expect(commitHistory).toHaveBeenLastCalledWith(ctx, "/w/a.vetd", "把导航栏改到左侧");
	});

	it("新一轮开始前先封存上一轮被中断的改动", async () => {
		const hooks = registered(makeCtx());
		const session = { id: "s", cwd: "/w" };
		await hooks.get("UserPromptSubmit")?.handler({ session, event: { prompt: "把导航栏改到左侧" } });
		// 用户按了停止：Stop 不触发，改动留在工作区。下一句话进来时必须先封存。
		await hooks.get("UserPromptSubmit")?.handler({ session, event: { prompt: "算了，改回去" } });
		expect(commitHistory).toHaveBeenLastCalledWith(expect.anything(), "/w/a.vetd", "把导航栏改到左侧（未完成）");
	});

	it("会话结束后不再拿旧标题", async () => {
		const hooks = registered(makeCtx());
		const session = { id: "s", cwd: "/w" };
		await hooks.get("UserPromptSubmit")?.handler({ session, event: { prompt: "把导航栏改到左侧" } });
		await hooks.get("SessionEnd")?.handler({ session, event: {} });
		await hooks.get("Stop")?.handler({ session, event: {} });
		expect(commitHistory).toHaveBeenLastCalledWith(expect.anything(), "/w/a.vetd", "更新设计");
	});
});
