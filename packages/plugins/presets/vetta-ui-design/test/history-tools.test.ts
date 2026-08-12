/**
 * vetd_history / vetd_restore 的对外合同：模型拿到什么、挑错版本时能不能自己改正。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listHistory = vi.fn();
const restoreDesign = vi.fn();

vi.mock("../src/history/history-client", () => ({ listHistory: (...args: unknown[]) => listHistory(...args) }));
vi.mock("../src/history/restore", () => ({ restoreDesign: (...args: unknown[]) => restoreDesign(...args) }));
vi.mock("../src/canvas/design-runtime", () => ({ getCanvasController: () => null }));

const { registerHistoryTools } = await import("../src/history/history-tools");

interface ToolRegistration {
	name: string;
	handler(context: {
		host: { fs: unknown };
		session: { cwd: string };
		trigger: { input: Record<string, unknown> };
	}): Promise<Record<string, unknown>>;
}

const tools = new Map<string, ToolRegistration>();
const ctx = {
	agent: {
		registerTool: (registration: ToolRegistration) => {
			tools.set(registration.name, registration);
			return { dispose: () => {} };
		},
	},
} as unknown as PluginContext;

function call(name: string, input: Record<string, unknown> = {}) {
	const tool = tools.get(name);
	if (!tool) throw new Error(`${name} 没有注册`);
	return tool.handler({ host: { fs: {} }, session: { cwd: "/w" }, trigger: { input } });
}

const commits = [
	{ sha: "c2", title: "登录页换成深色", timestamp: 1_700_000_000_000, files: ["frames/login.tsx"] },
	{ sha: "c1", title: "初始状态", timestamp: 1_699_000_000_000, files: [] },
];

beforeEach(() => {
	tools.clear();
	listHistory.mockReset().mockResolvedValue(commits);
	restoreDesign.mockReset().mockResolvedValue({
		restored: { sha: "c3", title: "恢复到：初始状态", timestamp: 0, files: [] },
		stashed: { sha: "st", title: "恢复前的状态", timestamp: 0, files: [] },
		reinstalled: false,
	});
	registerHistoryTools(ctx, {
		resolveVetdPath: async (_host, _cwd, explicit) => explicit ?? "/w/a.vetd",
		scopeUse: ["project", "conversation"],
		agentMode: ["work"],
	});
});

describe("vetd_history", () => {
	it("倒序返回版本，并标出哪一条是当前内容", async () => {
		const result = await call("vetd_history");
		const versions = result.versions as { version: string; current?: boolean }[];
		expect(versions.map((v) => v.version)).toEqual(["c2", "c1"]);
		// 不标出来的话，模型会把「当前」当成一个可回退的目标，恢复它是空操作。
		expect(versions[0]?.current).toBe(true);
		expect(versions[1]?.current).toBeUndefined();
	});

	it("解析不到设计时报错而不是返回空列表", async () => {
		registerHistoryTools(ctx, {
			resolveVetdPath: async () => {
				throw new Error("No .vetd design document in the workspace.");
			},
			scopeUse: ["project"],
			agentMode: ["work"],
		});
		expect(await call("vetd_history")).toMatchObject({ ok: false });
	});
});

describe("vetd_restore", () => {
	it("没给 version 就直接拒绝", async () => {
		expect(await call("vetd_restore")).toMatchObject({ ok: false });
		expect(restoreDesign).not.toHaveBeenCalled();
	});

	it("版本 id 不在历史里时让它先查一次，而不是硬试", async () => {
		const result = await call("vetd_restore", { version: "不存在" });
		expect(result.ok).toBe(false);
		expect(String(result.error)).toContain("vetd_history");
		expect(restoreDesign).not.toHaveBeenCalled();
	});

	it("恢复成功时报出「回去的路」——挑错版本能自己改正", async () => {
		const result = await call("vetd_restore", { version: "c1" });
		expect(result).toMatchObject({ ok: true, restoredTo: { version: "c1" }, previousStateSavedAs: "st" });
		expect(String(result.note)).toContain("nothing is lost");
	});

	it("内容与目标版本一致时如实说无事可做", async () => {
		restoreDesign.mockResolvedValue({ restored: null, stashed: null, reinstalled: false });
		expect(await call("vetd_restore", { version: "c1" })).toMatchObject({ ok: true, unchanged: true });
	});

	it("重装了依赖会报出来", async () => {
		restoreDesign.mockResolvedValue({
			restored: { sha: "c3", title: "x", timestamp: 0, files: ["package.json"] },
			stashed: null,
			reinstalled: true,
		});
		expect(await call("vetd_restore", { version: "c1" })).toMatchObject({ dependenciesReinstalled: true });
	});
});
