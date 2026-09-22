/**
 * canvas 流体：原来的 CSS 版每帧对大面积重做高斯模糊，GPU 随亮着的 frame 数飙升。
 * 这里守住三件事——画布很小、绘制不用 filter、所有 canvas 共用一个循环并能注销干净。
 */
import { afterEach, expect, it, vi } from "vitest";
import { activeFluidCount, drawFluid, fluidCanvasSize, startFluid } from "../src/canvas/fluid-canvas";

const COLORS = ["#0ea5e9", "#22d3ee", "#38bdf8", "#6366f1", "#2dd4bf"];

/** 记录调用的 2D context 替身：happy-dom 没有真正的 canvas 实现。 */
function recordingContext() {
	const calls: string[] = [];
	const props: Record<string, unknown> = {};
	const gradient = { addColorStop: () => {} };
	const ctx = new Proxy(
		{},
		{
			get(_target, key: string) {
				if (key in props) return props[key];
				if (key === "createRadialGradient") return () => gradient;
				return (...args: unknown[]) => calls.push(`${key}(${args.length})`);
			},
			set(_target, key: string, value) {
				props[key] = value;
				calls.push(`${key}=${String(value)}`);
				return true;
			},
		},
	) as unknown as CanvasRenderingContext2D;
	return { ctx, calls };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

it("keeps the canvas tiny and in the frame's aspect ratio", () => {
	expect(fluidCanvasSize(390, 844)).toEqual({ width: 30, height: 64 });
	expect(fluidCanvasSize(1440, 900)).toEqual({ width: 64, height: 40 });
	// 极端细长也至少留几个像素，不画成 0。
	expect(fluidCanvasSize(10, 5000).width).toBeGreaterThanOrEqual(4);
});

it("draws soft blobs and bakes the edge mask in without any filter", () => {
	const { ctx, calls } = recordingContext();
	drawFluid(ctx, 30, 64, 1234, COLORS);
	expect(calls.some((call) => call.startsWith("filter="))).toBe(false);
	expect(calls).toContain("globalCompositeOperation=destination-in");
	expect(calls.filter((call) => call.startsWith("fillRect")).length).toBe(COLORS.length + 1);
	// 画完复位，不把 destination-in 留给下一帧。
	expect(calls.at(-1)).toBe("globalCompositeOperation=source-over");
});

it("shares one animation loop across canvases and stops it when the last one leaves", () => {
	const rafs: FrameRequestCallback[] = [];
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => rafs.push(cb));
	const cancel = vi.fn();
	vi.stubGlobal("cancelAnimationFrame", cancel);
	const canvas = (): HTMLCanvasElement =>
		({ width: 30, height: 64, getContext: () => recordingContext().ctx, closest: () => null }) as unknown as HTMLCanvasElement;

	const stopA = startFluid(canvas(), COLORS);
	const stopB = startFluid(canvas(), COLORS);
	expect(activeFluidCount()).toBe(2);
	expect(rafs).toHaveLength(1);

	stopA();
	expect(cancel).not.toHaveBeenCalled();
	stopB();
	expect(activeFluidCount()).toBe(0);
	expect(cancel).toHaveBeenCalledTimes(1);
});
