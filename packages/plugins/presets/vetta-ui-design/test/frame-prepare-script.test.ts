/**
 * 离屏窗口复用时的切帧脚本（framePrepareScript）必须在两种情况下都能亮起
 * `__vetdPainted`：
 *
 * - 窗口正显示别的帧：发 show-frame，引擎切路由、React 提交后由 FramePainted 写回；
 * - 窗口已经在这一帧：切到同一路径时路由元素引用不变，React 直接跳过渲染，
 *   FramePainted 不会再跑。脚本若照样清空标记再干等，就只能耗到宿主超时
 *   （整份素材导出因此每帧白等 60s）。这时脚本得自己等一帧绘制后写回标记。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { framePrepareScript } from "../src/canvas/offscreen-raster";

type PageWindow = Window & { __vetdPainted?: string | null };

let posted: unknown[];
let frames: FrameRequestCallback[];

function flushFrames(): void {
	const pending = frames;
	frames = [];
	for (const callback of pending) callback(0);
}

async function settle(): Promise<void> {
	for (let round = 0; round < 4; round += 1) {
		flushFrames();
		await Promise.resolve();
		await Promise.resolve();
	}
}

beforeEach(() => {
	posted = [];
	frames = [];
	vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
		posted.push(message);
	});
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
		frames.push(callback);
		return frames.length;
	});
	Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
});

afterEach(() => {
	vi.restoreAllMocks();
	(window as PageWindow).__vetdPainted = undefined;
});

function run(script: string): void {
	// 与宿主 executeJavaScript 一样：在页面全局作用域里求值。
	new Function(script)();
}

it("re-arms the painted marker by itself when the window already shows that frame", async () => {
	(window as PageWindow).__vetdPainted = "login";
	run(framePrepareScript("login"));

	// 不能立刻命中旧值：本轮的布局（可能刚改过视口尺寸）还没画出来。
	expect((window as PageWindow).__vetdPainted).toBeNull();
	// 同一路径不会触发 React 提交，所以也不该指望引擎——不发 show-frame。
	expect(posted).toEqual([]);

	await settle();
	expect((window as PageWindow).__vetdPainted).toBe("login");
});

it("navigates and leaves the marker to the engine when the window shows another frame", async () => {
	(window as PageWindow).__vetdPainted = "cart";
	run(framePrepareScript('detail"quoted'));

	expect((window as PageWindow).__vetdPainted).toBeNull();
	expect(posted).toEqual([{ vetd: true, type: "show-frame", id: 'detail"quoted' }]);

	// 标记由引擎在新路由画完后写回，脚本自己不能抢先写——那样会截到上一帧的画面。
	await settle();
	expect((window as PageWindow).__vetdPainted).toBeNull();
});
