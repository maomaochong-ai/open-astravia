/**
 * 离屏窗口复用时的切帧脚本（framePrepareScript）必须在两种情况下都能亮起
 * `__vetdPainted`：
 *
 * - 窗口正显示别的帧：发 show-frame，引擎切路由、React 提交后由 FramePainted 写回；
 * - 窗口已经在这一帧：切到同一路径时路由元素引用不变，React 直接跳过渲染，
 *   FramePainted 不会再跑。脚本若照样清空标记再干等，就只能耗到宿主超时
 *   （整份素材导出因此每帧白等 60s）。这时脚本得自己等一帧绘制后写回标记。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FRAME_READY_EXPRESSION, framePrepareScript } from "../src/canvas/offscreen-raster";

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
	(window as Window & { __vetdNavFrom?: string }).__vetdNavFrom = undefined;
});

function run(script: string): void {
	// 与宿主 executeJavaScript 一样：在页面全局作用域里求值。
	new Function(script)();
}

it("re-arms the painted marker by itself when the window already shows that frame", async () => {
	window.history.replaceState(null, "", "/login");
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
	window.history.replaceState(null, "", "/cart");
	(window as PageWindow).__vetdPainted = "cart";
	run(framePrepareScript('detail"quoted'));

	expect((window as PageWindow).__vetdPainted).toBeNull();
	expect(posted).toEqual([{ vetd: true, type: "show-frame", id: 'detail"quoted' }]);

	// 标记由引擎在新路由画完后写回，脚本自己不能抢先写——那样会截到上一帧的画面。
	await settle();
	expect((window as PageWindow).__vetdPainted).toBeNull();
});

it("re-arms by the address bar even when a timed-out capture left the marker cleared", async () => {
	window.history.replaceState(null, "", "/login");
	(window as PageWindow).__vetdPainted = null;
	run(framePrepareScript("login"));
	expect(posted).toEqual([]);
	await settle();
	expect((window as PageWindow).__vetdPainted).toBe("login");
});

it("does not mistake the previous frame's late paint for the target before navigation lands", () => {
	window.history.replaceState({ key: "k-cart" }, "", "/cart");
	(window as PageWindow).__vetdPainted = "cart";
	run(framePrepareScript("detail"));
	const ready = (): boolean => new Function(`return (${FRAME_READY_EXPRESSION});`)() as boolean;

	// show-frame 还没被处理：地址仍是 /cart，上一帧迟到的标记落下来。
	(window as PageWindow).__vetdPainted = "cart";
	expect(ready()).toBe(false);

	// 引擎切了路由（新的历史 key），目标帧画完。
	window.history.pushState({ key: "k-detail" }, "", "/detail");
	(window as PageWindow).__vetdPainted = "detail";
	expect(ready()).toBe(true);
});

describe("frame ready expression", () => {
	function ready(): boolean {
		return new Function(`return (${FRAME_READY_EXPRESSION});`)() as boolean;
	}

	function showing(path: string, painted: string | null): void {
		window.history.replaceState(null, "", path);
		(window as PageWindow).__vetdPainted = painted;
	}

	it("is ready once the frame the address bar shows has painted", () => {
		showing("/detail", "detail");
		expect(ready()).toBe(true);
		showing("/", "index");
		expect(ready()).toBe(true);
		// 非 ASCII 的 frame id 在地址栏里是百分号编码的。
		showing(`/${encodeURIComponent("会议详情")}`, "会议详情");
		expect(ready()).toBe(true);
	});

	it("accepts a frame that redirects on mount instead of waiting for its own id forever", () => {
		// 截 index：它挂载后立刻 navigate("/welcome-ongoing")，写回的标记是跳转后那一帧。
		// 以前只认 `__vetdPainted === "index"`，每次都耗满宿主超时。
		showing("/welcome-ongoing", "welcome-ongoing");
		expect(ready()).toBe(true);
	});

	it("is not ready on a stale marker from the previous frame or before any paint", () => {
		// 切帧时地址已经同步换成目标，上一帧迟到的标记和地址对不上。
		showing("/detail", "cart");
		expect(ready()).toBe(false);
		showing("/detail", null);
		expect(ready()).toBe(false);
	});

	it("still waits for images to finish decoding", () => {
		showing("/detail", "detail");
		const image = document.createElement("img");
		Object.defineProperty(image, "complete", { configurable: true, value: false });
		document.body.appendChild(image);
		expect(ready()).toBe(false);
		image.remove();
	});
});
