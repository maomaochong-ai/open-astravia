import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
	created: [] as Array<{ offscreen: boolean; stopPainting: ReturnType<typeof vi.fn> }>,
}));

vi.mock("electron", () => ({
	BrowserWindow: class {
		webContents = {
			loadURL: vi.fn(async () => undefined),
			executeJavaScript: vi.fn(async () => true),
			capturePage: vi.fn(async () => ({
				getSize: () => ({ width: 780, height: 1688 }),
				toJPEG: () => Buffer.from("jpeg"),
				toPNG: () => Buffer.from("png"),
			})),
			stopPainting: vi.fn(),
			on: vi.fn(),
		};
		loadURL = this.webContents.loadURL;
		constructor(options: { webPreferences?: { offscreen?: boolean } }) {
			hooks.created.push({
				offscreen: options.webPreferences?.offscreen === true,
				stopPainting: this.webContents.stopPainting,
			});
		}
		getContentSize(): [number, number] {
			return [390, 844];
		}
		setContentSize(): void {}
		isDestroyed(): boolean {
			return false;
		}
		destroy(): void {}
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

afterEach(() => {
	destroyAllOffscreenSessions();
	hooks.created.length = 0;
});

/**
 * 离屏窗口默认按 60fps 在主进程里做整窗软件光栅化，页面上哪怕只有一个转圈动画，
 * 几个常驻会话就能把主进程吃到 100% 以上。截图走 capturePage，不依赖逐帧 paint，
 * 所以窗口一建好就必须停绘。
 */
describe("离屏截图窗口不得持续逐帧绘制", () => {
	it.each([
		["复用会话", { sessionKey: "design-raster:7788:0" }],
		["一次性窗口", {}],
	])("%s建窗后立即停绘", async (_label, extra) => {
		await capturePluginOffscreen("vetta-ui-design", {
			url: "http://127.0.0.1:7788/",
			width: 390,
			height: 844,
			format: "jpeg",
			...extra,
		});
		expect(hooks.created).toHaveLength(1);
		expect(hooks.created[0]?.offscreen).toBe(true);
		expect(hooks.created[0]?.stopPainting).toHaveBeenCalledTimes(1);
	});
});
