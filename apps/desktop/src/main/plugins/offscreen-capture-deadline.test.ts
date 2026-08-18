import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
	loadURL: vi.fn<(url: string) => Promise<void>>(),
	executeJavaScript: vi.fn<(code: string) => Promise<unknown>>(),
	capturePage: vi.fn<() => Promise<unknown>>(),
	destroyed: vi.fn<() => void>(),
}));

vi.mock("electron", () => ({
	BrowserWindow: class {
		webContents = {
			loadURL: hooks.loadURL,
			executeJavaScript: hooks.executeJavaScript,
			capturePage: hooks.capturePage,
			on: vi.fn(),
		};
		loadURL = hooks.loadURL;
		getContentSize(): [number, number] {
			return [390, 844];
		}
		setContentSize(): void {}
		isDestroyed(): boolean {
			return false;
		}
		destroy(): void {
			hooks.destroyed();
		}
	},
}));

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("./plugin-catalog.js", () => ({
	listPlugins: () => [
		{
			id: "vetta-ui-design",
			enabled: true,
			permissions: ["capture.offscreen"],
			grantedPermissions: ["capture.offscreen"],
		},
	],
}));

import { capturePluginOffscreen, destroyAllOffscreenSessions } from "./offscreen-capture-service.js";

const NEVER = new Promise<never>(() => {});

function baseOptions(overrides: Record<string, unknown> = {}) {
	return {
		url: "http://127.0.0.1:7788/",
		width: 390,
		height: 844,
		sessionKey: "design-raster:7788:0",
		readyExpression: "window.__vetdPainted === 'a'",
		timeoutMs: 200,
		format: "jpeg" as const,
		quality: 0.8,
		...overrides,
	};
}

/**
 * 在 wall-clock 期限内取 promise 的结局：`hung` 表示到点还没 settle（回归时的失败形态）。
 */
async function outcomeWithin(promise: Promise<unknown>, ms: number): Promise<string> {
	return await Promise.race([
		promise.then(
			() => "resolved",
			(error: unknown) => (error instanceof Error ? error.message : String(error)),
		),
		new Promise<string>((resolve) => setTimeout(() => resolve("hung"), ms)),
	]);
}

afterEach(() => {
	destroyAllOffscreenSessions();
	vi.clearAllMocks();
});

describe("离屏截图必须受 timeoutMs 整体约束", () => {
	it("readyExpression 求值卡住时也要在期限内失败", async () => {
		hooks.loadURL.mockResolvedValue(undefined);
		hooks.executeJavaScript.mockReturnValue(NEVER);
		const result = await outcomeWithin(capturePluginOffscreen("vetta-ui-design", baseOptions()), 1_500);
		expect(result).toContain("readyExpression");
		expect(result).toContain("timed out");
	});

	it("页面加载卡住时也要在期限内失败", async () => {
		hooks.loadURL.mockReturnValue(NEVER);
		hooks.executeJavaScript.mockResolvedValue(true);
		const result = await outcomeWithin(capturePluginOffscreen("vetta-ui-design", baseOptions()), 1_500);
		expect(result).toContain("loadURL");
	});

	it("capturePage 卡住时也要在期限内失败", async () => {
		hooks.loadURL.mockResolvedValue(undefined);
		hooks.executeJavaScript.mockResolvedValue(true);
		hooks.capturePage.mockReturnValue(NEVER);
		const result = await outcomeWithin(capturePluginOffscreen("vetta-ui-design", baseOptions()), 1_500);
		expect(result).toContain("capturePage");
	});

	it("一次卡死的请求不得让同 sessionKey 的后续请求永久排队", async () => {
		hooks.loadURL.mockResolvedValue(undefined);
		hooks.executeJavaScript.mockReturnValue(NEVER);
		const first = capturePluginOffscreen("vetta-ui-design", baseOptions());
		void first.catch(() => undefined);
		const second = capturePluginOffscreen("vetta-ui-design", baseOptions());
		void second.catch(() => undefined);
		// 排在后面的请求也要按自己的预算失败，而不是永远排在那堵墙后面。
		expect(await outcomeWithin(second, 2_000)).toContain("timed out");
	});

	it("超时后销毁旧窗口，下一次请求换新窗口重来", async () => {
		hooks.loadURL.mockResolvedValue(undefined);
		hooks.executeJavaScript.mockReturnValue(NEVER);
		await outcomeWithin(capturePluginOffscreen("vetta-ui-design", baseOptions()), 1_500);
		expect(hooks.destroyed).toHaveBeenCalledTimes(1);
	});
});
