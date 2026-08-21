/**
 * 设计工具的可见性闸门。
 *
 * 回归的是一个具体故障：用户在自己的代码仓库里改前端页面，agent 每一轮结尾仍会
 * 调一次 vetd_notes（skill 的收尾自检把它带出来），而工作区里根本没有 .vetd，
 * 调用注定报错。工具表本身是这条防线的硬边界。
 */
import type { PluginContext, PluginFsFileRef } from "@vetta-org/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setCanvasController } from "../src/canvas/design-runtime";
import { resetDesignPresence, setDesignPresence } from "../src/vetd/design-presence";
import { DESIGN_ONLY_TOOLS, registerToolGate } from "../src/vetd/tool-gate";

interface Provider {
	id: string;
	handler: (context: { session: { cwd: string } }) => Promise<unknown>;
}

function ref(relPath: string): PluginFsFileRef {
	const name = relPath.split("/").pop() ?? relPath;
	return { name, path: `/proj/${relPath}`, relPath } as PluginFsFileRef;
}

function harness(files: PluginFsFileRef[]) {
	let listCalls = 0;
	const providers: Provider[] = [];
	const ctx = {
		fs: {
			listFilesRecursive: async () => {
				listCalls += 1;
				return files;
			},
		},
		agent: {
			registerSystemPromptProvider: (provider: Provider) => {
				providers.push(provider);
				return { dispose: () => {} };
			},
		},
	} as unknown as PluginContext;
	registerToolGate(ctx);
	return {
		provider: providers[0],
		listCalls: () => listCalls,
	};
}

async function run(provider: Provider, cwd = "/proj"): Promise<{ toolName: string; enabled: boolean }[]> {
	return (await provider.handler({ session: { cwd } })) as { toolName: string; enabled: boolean }[];
}

beforeEach(() => {
	resetDesignPresence();
	setCanvasController(null);
});

afterEach(() => {
	resetDesignPresence();
	setCanvasController(null);
});

describe("设计工具闸门", () => {
	it("纯代码仓库里关掉全部设计专用工具", async () => {
		const { provider } = harness([ref("src/pages/home.tsx"), ref("package.json")]);
		const effects = await run(provider);
		expect(effects.map((effect) => effect.toolName)).toEqual([...DESIGN_ONLY_TOOLS]);
		expect(effects.every((effect) => effect.enabled)).toBe(false);
		// 入口工具不能被关掉，否则没有设计的会话再也建不出设计。
		expect(effects.some((effect) => effect.toolName === "vetd_create")).toBe(false);
	});

	it("工作区里有设计稿就放行", async () => {
		const { provider } = harness([ref("src/pages/home.tsx"), ref("landing.vetd/design.json")]);
		const effects = await run(provider);
		expect(effects.every((effect) => effect.enabled)).toBe(true);
	});

	it("画布开着时不管工作区扫描结果都放行", async () => {
		const { provider, listCalls } = harness([ref("src/pages/home.tsx")]);
		setCanvasController({} as never);
		const effects = await run(provider);
		expect(effects.every((effect) => effect.enabled)).toBe(true);
		expect(listCalls()).toBe(0);
	});

	it("同一 cwd 只扫一次工作区", async () => {
		const { provider, listCalls } = harness([ref("src/pages/home.tsx")]);
		await run(provider);
		await run(provider);
		expect(listCalls()).toBe(1);
	});

	it("会话中途建出设计后下一轮就放行", async () => {
		const { provider } = harness([ref("src/pages/home.tsx")]);
		expect((await run(provider)).every((effect) => effect.enabled)).toBe(false);
		// vetd_create 落盘后喂进来的结论。
		setDesignPresence("/proj", true);
		expect((await run(provider)).every((effect) => effect.enabled)).toBe(true);
	});

	it("列举失败按没有设计处理", async () => {
		const providers: Provider[] = [];
		const ctx = {
			fs: {
				listFilesRecursive: async () => {
					throw new Error("denied");
				},
			},
			agent: {
				registerSystemPromptProvider: (provider: Provider) => {
					providers.push(provider);
					return { dispose: () => {} };
				},
			},
		} as unknown as PluginContext;
		registerToolGate(ctx);
		expect((await run(providers[0])).every((effect) => effect.enabled)).toBe(false);
	});
});
