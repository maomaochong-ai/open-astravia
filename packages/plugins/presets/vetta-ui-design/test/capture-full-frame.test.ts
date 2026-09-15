/**
 * 整帧截图的编排：先量、再把离屏视口拉高到内容刚好放得下；拉到宿主上限还不够
 * 就按滚动分块拼接。宿主离屏窗口是唯一的外部边界，用一个「会随视口高度回答探针」
 * 的假页面代替。
 */
import type { PluginOffscreenCaptureOptions, PluginOffscreenCaptureResult } from "@vetta-org/plugin-sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	captureFullFrame,
	type FullFrameDeps,
	OFFSCREEN_MAX_VIEWPORT_PX,
} from "../src/materials/capture-full-frame";

interface FakePage {
	/** 文档滚动：内容总高。 */
	document?: number;
	/** App 骨架：顶栏高 / 底栏高 / 中间 h-full 滚动区的内容高。 */
	app?: { header: number; footer: number; content: number };
}

interface Shot {
	height: number;
	prepare: string;
	probe: string | undefined;
	format: string | undefined;
}

let shots: Shot[];
let drawn: Array<{ srcY: number; srcH: number; destY: number; destH: number }>;

const SCALE = 2;

function scrollTopOf(prepare: string): number {
	const match = /var TOP = (\d+)/.exec(prepare);
	return match ? Number(match[1]) : 0;
}

/** 按当前视口高度回答探针，像真实页面那样：h-full 的滚动区随视口长高。 */
function probeFor(page: FakePage, viewportHeight: number): unknown {
	if (page.app) {
		const visible = viewportHeight - page.app.header - page.app.footer;
		return {
			viewportWidth: 390,
			viewportHeight,
			kind: "element",
			hidden: Math.max(0, page.app.content - visible),
			top: page.app.header,
			bottom: viewportHeight - page.app.footer,
		};
	}
	return {
		viewportWidth: 1440,
		viewportHeight,
		kind: "document",
		hidden: Math.max(0, (page.document ?? viewportHeight) - viewportHeight),
		top: 0,
		bottom: viewportHeight,
	};
}

function depsFor(page: FakePage): FullFrameDeps {
	return {
		capture: async (options: PluginOffscreenCaptureOptions): Promise<PluginOffscreenCaptureResult> => {
			shots.push({ height: options.height, prepare: options.prepareScript ?? "", probe: options.probeScript, format: options.format });
			const isMeasure = options.probeScript?.includes("viewportHeight") === true;
			const scrollTop = scrollTopOf(options.prepareScript ?? "");
			return {
				dataUrl: `shot:${options.width}x${options.height}@${scrollTop}`,
				scaleFactor: SCALE,
				probe: isMeasure ? probeFor(page, options.height) : options.probeScript ? true : undefined,
			};
		},
		loadImage: async (dataUrl) => {
			const match = /^shot:(\d+)x(\d+)@/.exec(dataUrl) ?? /^stitched:(\d+)x(\d+)/.exec(dataUrl);
			if (!match) throw new Error(`unexpected data url ${dataUrl}`);
			return { naturalWidth: Number(match[1]) * SCALE, naturalHeight: Number(match[2]) * SCALE } as HTMLImageElement;
		},
	};
}

beforeEach(() => {
	shots = [];
	drawn = [];
	// happy-dom 没有 2D 上下文：记录每次 drawImage 的源/目标行段，拼接是否正确看它。
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
		return {
			fillStyle: "",
			fillRect: () => {},
			drawImage: (_image: unknown, _sx: number, sy: number, _sw: number, sh: number, _dx: number, dy: number, _dw: number, dh: number) => {
				drawn.push({ srcY: sy, srcH: sh, destY: dy, destH: dh });
			},
		} as unknown as CanvasRenderingContext2D;
	});
	vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (this: HTMLCanvasElement) {
		return `stitched:${this.width / SCALE}x${this.height / SCALE}`;
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

const request = { port: 5173, frameId: "home", width: 1440, height: 900, format: "png" as const };

it("returns the viewport shot as-is when nothing scrolls", async () => {
	const image = await captureFullFrame(depsFor({ document: 900 }), request);
	expect(shots).toHaveLength(1);
	expect(shots[0]?.height).toBe(900);
	expect(shots[0]?.format).toBe("png");
	expect(image).toEqual({ dataUrl: "shot:1440x900@0", cssWidth: 1440, cssHeight: 900, pixelWidth: 2880, pixelHeight: 1800 });
});

it("grows the offscreen viewport to the full content height instead of scrolling", async () => {
	// 落地页：视口 900，内容 3200——第二张就是完整的一张。
	const image = await captureFullFrame(depsFor({ document: 3200 }), request);
	expect(shots.map((shot) => shot.height)).toEqual([900, 3200]);
	expect(image.cssHeight).toBe(3200);
	expect(image.pixelHeight).toBe(6400);
	expect(drawn).toHaveLength(0);
});

it("lets a h-full scroller expand so the footer lands at the real bottom", async () => {
	// App 页：60 顶栏 + 84 底栏，中间内容 1500；844 视口里可见 700。
	const image = await captureFullFrame(depsFor({ app: { header: 60, footer: 84, content: 1500 } }), {
		...request,
		width: 390,
		height: 844,
	});
	expect(shots.map((shot) => shot.height)).toEqual([844, 1644]);
	expect(image.cssHeight).toBe(1644);
});

it("tiles by scrolling once the host viewport limit is reached and resets the scroll afterwards", async () => {
	// 内容 7000px：视口只能拉到 4096，剩下 2904 滚一页（滚到底、与上一页重叠 1192 行）。
	const image = await captureFullFrame(depsFor({ document: 7000 }), request);
	const heights = shots.map((shot) => shot.height);
	expect(heights[0]).toBe(900);
	expect(heights.slice(1).every((height) => height === OFFSCREEN_MAX_VIEWPORT_PX)).toBe(true);
	// 第一块复用量高度那一张；之后只多截一块，滚到 2904。
	expect(shots).toHaveLength(3);
	expect(scrollTopOf(shots[2]?.prepare ?? "")).toBe(2904);
	// 最后一块出图后把滚动归零，共用这个窗口的下一张截图不会接手一个滚到底的页面。
	expect(shots.at(-1)?.probe).toContain("scrollTop = 0");
	// 拼接：两块首尾相接，正好铺满 7000 行（物理像素 ×2），第二块从重叠行之后取。
	expect(drawn.map((entry) => [entry.srcY, entry.destY, entry.destH])).toEqual([
		[0, 0, 4096 * SCALE],
		[1192 * SCALE, 4096 * SCALE, 2904 * SCALE],
	]);
	expect(image).toEqual({
		dataUrl: "stitched:1440x7000",
		cssWidth: 1440,
		cssHeight: 7000,
		pixelWidth: 2880,
		pixelHeight: 14_000,
	});
});

it("scales the stitched image down instead of cropping when it would exceed the canvas limit", async () => {
	// 10000px × 2 倍 = 20000 物理像素，超过拼接画布上限：整体等比缩到上限，内容一行不少。
	const image = await captureFullFrame(depsFor({ document: 10_000 }), request);
	expect(image.cssHeight).toBe(10_000);
	expect(image.pixelHeight).toBe(16_384);
	expect(image.pixelWidth).toBe(Math.round(1440 * 2 * (16_384 / 20_000)));
	const covered = drawn.reduce((sum, entry) => sum + entry.destH, 0);
	expect(Math.round(covered)).toBe(16_384);
});

it("retries a shot once after a host timeout and gives up on the second", async () => {
	// 引擎冷启动：第一次请求在编译中超时，宿主销毁窗口；紧接着的重试拿到热服务器。
	const deps = depsFor({ document: 900 });
	let failures = 1;
	const flaky: FullFrameDeps = {
		...deps,
		capture: async (options) => {
			if (failures > 0) {
				failures -= 1;
				throw new Error("Error invoking remote method 'vetta:plugins:offscreen-capture': Capture timed out before readyExpression");
			}
			return deps.capture(options);
		},
	};
	await expect(captureFullFrame(flaky, request)).resolves.toMatchObject({ cssHeight: 900 });
	expect(shots).toHaveLength(1);

	failures = 2;
	await expect(captureFullFrame(flaky, request)).rejects.toThrow("Capture timed out");
});

it("does not retry errors that a fresh window would not fix", async () => {
	let calls = 0;
	const dead: FullFrameDeps = {
		...depsFor({ document: 900 }),
		capture: async () => {
			calls += 1;
			throw new Error("connect ECONNREFUSED 127.0.0.1:5173");
		},
	};
	await expect(captureFullFrame(dead, request)).rejects.toThrow("ECONNREFUSED");
	expect(calls).toBe(1);
});

it("falls back to the viewport shot when the probe did not run", async () => {
	const deps = depsFor({ document: 5000 });
	const broken: FullFrameDeps = {
		...deps,
		capture: async (options) => ({ ...(await deps.capture(options)), probe: undefined }),
	};
	const image = await captureFullFrame(broken, request);
	expect(shots).toHaveLength(1);
	expect(image.cssHeight).toBe(900);
});
