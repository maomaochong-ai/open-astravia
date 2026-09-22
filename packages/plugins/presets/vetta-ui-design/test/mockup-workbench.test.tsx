import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../src/plugin-context", () => ({
	getPluginCtx: () => ({ fs: {}, ui: {} }),
	notify: vi.fn(),
}));
// 位图链路在 happy-dom 里没有解码器：截图结果换成占位对象，工作台只关心「有没有」。
vi.mock("../src/mockup/load-image", () => ({
	loadImage: () => Promise.resolve({} as HTMLImageElement),
}));
vi.mock("../src/canvas/raster-cache", () => ({
	loadRasters: () => Promise.resolve(new Map<string, string>()),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { type MockupExportRequest, requestMockupExport } from "../src/canvas/design-runtime";
import { ExportMockupDialog } from "../src/mockup/ExportMockupDialog";

/** React 19 的 act 需要这个开关，否则每次更新都会告警。 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STAGE = { width: 900, height: 700 };

/**
 * happy-dom 不做布局，任何元素量出来都是 0×0——而工作台正是靠量出来的视口尺寸
 * 决定初始缩放。这个替身在 observe 时报一个固定尺寸，把「测量 → 自动 fit」这条
 * 链路接上。
 */
class StubResizeObserver {
	constructor(private readonly callback: ResizeObserverCallback) {}
	observe(target: Element): void {
		this.callback([{ target, contentRect: STAGE } as unknown as ResizeObserverEntry], this as never);
	}
	disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;

let host: HTMLDivElement;
let root: Root;

function frame(id: string, x: number) {
	return { id, title: id.toUpperCase(), file: `${id}.tsx`, x, y: 0, width: 390, height: 844 };
}

function makeRequest(initialFrameIds: string[] = []): MockupExportRequest {
	const session = {
		vetdPath: "/tmp/demo.vetd",
		name: "demo",
		manifest: { frames: [frame("a", 0), frame("b", 500), frame("c", 1000)] },
		readThemeCss: () => Promise.resolve(""),
	};
	return {
		session: session as unknown as MockupExportRequest["session"],
		initialFrameIds,
		capture: () => Promise.resolve("data:image/png;base64,AA=="),
	};
}

/** 已加入渲染区的画框在预览层各有一块命中区，用 aria-label 找。 */
function staged(): string[] {
	return [...document.body.querySelectorAll<HTMLElement>("[draggable='true'][aria-label]")].map(
		(element) => element.getAttribute("aria-label") ?? "",
	);
}

/** 左侧缩略图列表项：按标题找。 */
function railItem(title: string): HTMLElement | null {
	return [...document.body.querySelectorAll<HTMLElement>("button[title]")].find(
		(element) => element.getAttribute("title") === title,
	) ?? null;
}

/** 预览位图。工作台没内容时它不存在。 */
function previewCanvas(): HTMLCanvasElement {
	const canvas = document.body.querySelector<HTMLCanvasElement>("canvas[aria-label='mockup.preview.alt']");
	if (!canvas) throw new Error("missing preview canvas");
	return canvas;
}

/** 被 transform 缩放的 world 层：stage > world > pageBox > page 包装 > canvas。 */
function worldLayer(): HTMLElement {
	const world = previewCanvas().parentElement?.parentElement?.parentElement;
	if (!world) throw new Error("missing world layer");
	return world;
}

function scaleOf(transform: string): number {
	const match = /scale\((-?[\d.]+)\)/.exec(transform);
	return match?.[1] ? Number.parseFloat(match[1]) : 1;
}

function translateOf(transform: string): { x: number; y: number } {
	const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(transform);
	if (!match?.[1] || !match[2]) throw new Error(`no translate in "${transform}"`);
	return { x: Number.parseFloat(match[1]), y: Number.parseFloat(match[2]) };
}

function byText(text: string): HTMLElement | null {
	return [...document.body.querySelectorAll<HTMLElement>("button")].find(
		(element) => element.textContent?.trim() === text,
	) ?? null;
}

function click(element: HTMLElement | null): void {
	if (!element) throw new Error("missing element");
	act(() => {
		element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
	});
}

/** 截图是异步的：让 promise 队列跑完，state 才落到 DOM 上。 */
async function flush(): Promise<void> {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

beforeEach(() => {
	// happy-dom 不一定挂 localStorage；工作台读不到就用默认设置，正是这里要的起点。
	globalThis.localStorage?.clear();
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => requestMockupExport(null));
	act(() => root.unmount());
	host.remove();
	document.body.innerHTML = "";
});

describe("ExportMockupDialog", () => {
	it("draws nothing until the canvas asks for it", async () => {
		act(() => root.render(<ExportMockupDialog />));
		await flush();
		expect(document.body.textContent).not.toContain("mockup.title");
	});

	// 顶栏入口不要求先选中：工作台开出来渲染区是空的，画框全在左侧列表里。
	it("opens empty when no frame was preselected", async () => {
		act(() => root.render(<ExportMockupDialog />));
		act(() => requestMockupExport(makeRequest()));
		await flush();

		expect(document.body.textContent).toContain("mockup.empty.title");
		expect(railItem("A")).not.toBeNull();
		expect(railItem("C")).not.toBeNull();
		expect(staged()).toEqual([]);
	});

	it("seeds the staging area from the canvas selection", async () => {
		act(() => root.render(<ExportMockupDialog />));
		act(() => requestMockupExport(makeRequest(["b"])));
		await flush();

		expect(staged()).toEqual(["B"]);
		// 已加入的那个不再出现在左侧列表里。
		expect(railItem("B")).toBeNull();
	});

	it("attaches on click and removes the thumbnail from the rail", async () => {
		act(() => root.render(<ExportMockupDialog />));
		act(() => requestMockupExport(makeRequest()));
		await flush();

		click(railItem("A"));
		await flush();

		expect(staged()).toEqual(["A"]);
		expect(railItem("A")).toBeNull();
	});

	// 加入 → 在渲染区选中 → 右侧选项区移除 → 回到左侧列表。
	it("removes the selected frame from the options card", async () => {
		act(() => root.render(<ExportMockupDialog />));
		act(() => requestMockupExport(makeRequest(["a"])));
		await flush();

		click(document.body.querySelector<HTMLElement>("[aria-label='A']"));
		click(byText("mockup.selected.remove"));
		await flush();

		expect(staged()).toEqual([]);
		expect(railItem("A")).not.toBeNull();
	});

	it("adds every remaining frame at once", async () => {
		act(() => root.render(<ExportMockupDialog />));
		act(() => requestMockupExport(makeRequest(["b"])));
		await flush();

		click(byText("mockup.rail.addAll"));
		await flush();

		expect(staged()).toEqual(["B", "A", "C"]);
		expect(document.body.textContent).toContain("mockup.rail.allAdded");
	});

	/**
	 * 自适应：工作台一有内容就该铺满窗口居中，而不是以 100% 钉在原点。
	 * 曾经量视口的 effect 挂在只跑一次的 ref 上，而预览台是收到请求之后才出现的
	 * 节点——尺寸永远量不到，视口停在 0，自动 fit 从不触发。
	 */
	it("fits the composition into the measured stage instead of leaving it at 100%", async () => {
		act(() => root.render(<ExportMockupDialog />));
		act(() => requestMockupExport(makeRequest(["a"])));
		await flush();

		// 页面在世界坐标里排版，屏幕尺寸 = 世界尺寸 * world 层的 transform 缩放。
		const zoom = scaleOf(worldLayer().style.transform);
		const page = previewCanvas().parentElement;
		const width = Number.parseFloat(page?.style.width ?? "0") * zoom;
		const height = Number.parseFloat(page?.style.height ?? "0") * zoom;
		expect(zoom).toBeGreaterThan(0);
		expect(width).toBeGreaterThan(0);
		expect(width).toBeLessThanOrEqual(STAGE.width);
		expect(height).toBeLessThanOrEqual(STAGE.height);
	});

	/**
	 * 触控板两指缩放的顺滑来源：手势中只动 world 层的 CSS transform（位图被拉伸），
	 * 停下来才按最终倍率重新光栅化。曾经每个 pinch tick 都重画整页位图，预览一缩就卡。
	 */
	it("pinch-zooms via the world transform and re-rasterizes only after the gesture settles", async () => {
		vi.useFakeTimers();
		try {
			act(() => root.render(<ExportMockupDialog />));
			act(() => requestMockupExport(makeRequest(["a"])));
			await flush();
			// 吃掉初始 fit 的光栅化落定，拿到稳定基线。
			act(() => vi.advanceTimersByTime(500));

			const world = worldLayer();
			const stage = world.parentElement;
			if (!stage) throw new Error("missing stage");
			const scaleBefore = scaleOf(world.style.transform);
			const rasterBefore = previewCanvas().width;

			act(() => {
				const pinch = new WheelEvent("wheel", { deltaY: -200, clientX: 100, clientY: 100, bubbles: true, cancelable: true });
				// happy-dom 的 WheelEventInit 丢掉修饰键；pinch 在浏览器里就是 ctrl+wheel。
				Object.defineProperty(pinch, "ctrlKey", { value: true });
				stage.dispatchEvent(pinch);
			});

			// 手势 tick：transform 立即变，位图不重画。
			expect(scaleOf(world.style.transform)).toBeGreaterThan(scaleBefore);
			expect(previewCanvas().width).toBe(rasterBefore);

			// 落定分两段：先是视口本身回到 state（缩放途中只写 DOM，见 use-viewport），
			// 再是位图按这个最终倍率重画。两段各等一次。
			act(() => vi.advanceTimersByTime(500));
			act(() => vi.advanceTimersByTime(500));
			expect(previewCanvas().width).toBeGreaterThan(rasterBefore);
		} finally {
			vi.useRealTimers();
		}
	});

	// 滚轮/触控板双指平移不进 React state：直接写 world 层的 transform（rAF 折叠）。
	it("pans with the wheel by writing the world transform directly", async () => {
		act(() => root.render(<ExportMockupDialog />));
		act(() => requestMockupExport(makeRequest(["a"])));
		await flush();

		const world = worldLayer();
		const stage = world.parentElement;
		if (!stage) throw new Error("missing stage");
		const before = translateOf(world.style.transform);

		act(() => {
			stage.dispatchEvent(new WheelEvent("wheel", { deltaX: 30, deltaY: 40, bubbles: true, cancelable: true }));
		});
		await act(async () => {
			await new Promise((resolve) => requestAnimationFrame(resolve));
		});

		const after = translateOf(world.style.transform);
		expect(after.x).toBeCloseTo(before.x - 30);
		expect(after.y).toBeCloseTo(before.y - 40);
	});

	// 每页画框数是导出页数的唯一来源：超出就换页，导出入口也跟着从 PNG 变长图。
	it("repaginates and offers a long image once the frames overflow one page", async () => {
		act(() => root.render(<ExportMockupDialog />));
		act(() => requestMockupExport(makeRequest(["a", "b", "c"])));
		await flush();

		expect(byText("mockup.format.png")).not.toBeNull();
		expect(byText("mockup.format.longImage")).toBeNull();

		click(byText("2"));
		await flush();

		expect(byText("mockup.format.longImage")).not.toBeNull();
		expect(byText("mockup.format.png")).toBeNull();
		expect(staged()).toEqual(["A", "B", "C"]);
	});

	/**
	 * 预览加载慢/加载不出来的根因：每加一帧都排进画布的串行截图锁、临时拉起活体 iframe
	 * 重截一遍。画布已经有这一帧的位图时直接用，一次截图都不排。
	 */
	it("previews with the canvas raster instead of queueing a capture", async () => {
		const capture = vi.fn(() => Promise.resolve("data:image/png;base64,AA=="));
		act(() => root.render(<ExportMockupDialog />));
		act(() =>
			requestMockupExport({
				...makeRequest(["a", "b"]),
				cachedImage: () => "data:image/jpeg;base64,AA==",
				capture,
			}),
		);
		await flush();

		expect(capture).not.toHaveBeenCalled();
		expect(document.body.textContent).not.toContain("mockup.shot.failed");
	});

	it("falls back to a live capture only for frames the canvas has no raster for", async () => {
		const capture = vi.fn(() => Promise.resolve("data:image/png;base64,AA=="));
		act(() => root.render(<ExportMockupDialog />));
		act(() =>
			requestMockupExport({
				...makeRequest(["a", "b"]),
				cachedImage: (frameId) => (frameId === "a" ? "data:image/jpeg;base64,AA==" : null),
				capture,
			}),
		);
		await flush();

		expect(capture).toHaveBeenCalledTimes(1);
		expect(capture.mock.calls[0]?.[0]).toBe("b");
	});

	// 截图卡住（锁上排着、rAF 停摆）时不能永远显示「截图中」：到点给错误和重试。
	it("gives up on a stuck capture with a retry instead of spinning forever", async () => {
		vi.useFakeTimers();
		try {
			const signals: AbortSignal[] = [];
			const capture = vi.fn((_frameId: string, _ratio: number, signal?: AbortSignal) => {
				if (signal) signals.push(signal);
				return new Promise<string>(() => {});
			});
			act(() => root.render(<ExportMockupDialog />));
			act(() => requestMockupExport({ ...makeRequest(["a"]), capture }));
			await flush();
			expect(document.body.textContent).not.toContain("mockup.shot.failed");

			act(() => vi.advanceTimersByTime(15_000));
			await flush();

			expect(document.body.textContent).toContain("mockup.shot.timeout");
			expect(byText("mockup.shot.retry")).not.toBeNull();
			// 超时同时中止：还排在锁上的话，这次截图就不再执行。
			expect(signals[0]?.aborted).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	// 关掉工作台后，排在锁上的旧截图不能照跑——否则下次打开要先等上一轮整队截完。
	it("aborts pending captures when the workbench closes", async () => {
		const signals: AbortSignal[] = [];
		const capture = vi.fn((_frameId: string, _ratio: number, signal?: AbortSignal) => {
			if (signal) signals.push(signal);
			return new Promise<string>(() => {});
		});
		act(() => root.render(<ExportMockupDialog />));
		act(() => requestMockupExport({ ...makeRequest(["a", "b"]), capture }));
		await flush();
		expect(signals).toHaveLength(2);
		expect(signals.some((signal) => signal.aborted)).toBe(false);

		act(() => requestMockupExport(null));
		await flush();

		expect(signals.every((signal) => signal.aborted)).toBe(true);
	});

	it("aborts a frame's pending capture when it is removed from the stage", async () => {
		const signals = new Map<string, AbortSignal>();
		const capture = vi.fn((frameId: string, _ratio: number, signal?: AbortSignal) => {
			if (signal) signals.set(frameId, signal);
			return new Promise<string>(() => {});
		});
		act(() => root.render(<ExportMockupDialog />));
		act(() => requestMockupExport({ ...makeRequest(["a", "b"]), capture }));
		await flush();

		click(document.body.querySelector<HTMLElement>("[aria-label='A']"));
		click(byText("mockup.selected.remove"));
		await flush();

		expect(signals.get("a")?.aborted).toBe(true);
		expect(signals.get("b")?.aborted).toBe(false);
	});
});
