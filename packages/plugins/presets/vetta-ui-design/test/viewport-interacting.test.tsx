/**
 * 缩放/平移途中的视口行为。
 *
 * 一、「这一趟操作还在进行」这个信号（ViewportController.interacting）。画布据它把自己
 * 拍平：冷启动时每个还没截到位图的画框都盖着一层 26px 模糊 + 无限旋转的流体占位，全都套
 * 在 world 的 scale 底下，缩放每变一档就得整层重新光栅化。操作期间摘掉它们，结束再恢复。
 * 守两条：一趟操作里只翻一次（中途不能亮灭），以及一定会自己落回。
 *
 * 二、缩放途中不进 React state。缩放曾经每个 wheel tick 都 commit，于是每次捏合都把整棵
 * 画布树连同 N 个 FrameView 的 props 比对重跑一遍、还附带一次视口落盘——这就是缩放不跟手
 * 的来源。现在与平移同路：逐 tick 只写 DOM（transform 与反向缩放变量），落定才提交一次。
 */
import { act, createElement, type JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { inverseScale, useViewport, type ViewportController } from "../src/canvas/use-viewport";

/** INTERACT_SETTLE_MS 的镜像：测试只需要「大于静置时间」，不必逐字节同步。 */
const SETTLE = 220;

let controller: ViewportController;
let root: Root;
let host: HTMLElement;
/** 落定提交的次数与值——缩放途中一次都不该有。 */
let commits: number[];
/** Harness 渲染次数：缩放途中画布树不该跟着重渲染。 */
let renders: number;
/** 手动驱动的 rAF：schedulePaint 把绘制折叠到帧上，测试要能一帧一帧地放行。 */
let rafQueue: Array<() => void>;

function Harness(): JSX.Element {
	const view = useViewport({
		initial: { x: 0, y: 0, zoom: 1 },
		onCommit: (next) => commits.push(next.zoom),
	});
	controller = view;
	renders += 1;
	return createElement(
		"div",
		{ ref: view.containerRef, style: { width: "800px", height: "600px" } },
		createElement("div", { ref: view.worldRef }),
	);
}

/** 走完一帧：只跑当前排队的回调。 */
async function paintFrame(): Promise<void> {
	const due = rafQueue;
	rafQueue = [];
	await act(async () => {
		for (const callback of due) callback();
	});
}

function world(): HTMLElement {
	const element = controller.worldRef.current;
	if (!element) throw new Error("world layer not rendered");
	return element;
}

function wheel(overrides: Partial<Parameters<ViewportController["applyWheel"]>[0]>) {
	return { deltaX: 0, deltaY: 0, clientX: 400, clientY: 300, ctrlKey: false, metaKey: false, ...overrides };
}

async function advance(ms: number): Promise<void> {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}

beforeEach(async () => {
	vi.useFakeTimers();
	(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
	commits = [];
	renders = 0;
	rafQueue = [];
	vi.stubGlobal("requestAnimationFrame", (callback: () => void) => rafQueue.push(callback));
	vi.stubGlobal("cancelAnimationFrame", () => {});
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	await act(async () => {
		root.render(createElement(Harness));
	});
});

afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it("缩放途中一直算「操作中」，停下之后自己落回", async () => {
	expect(controller.interacting).toBe(false);

	await act(async () => controller.applyWheel(wheel({ deltaY: -20, ctrlKey: true })));
	expect(controller.interacting).toBe(true);

	// 触控板一趟捏合是几十个 tick：中途不能落回，否则动画层会一路亮灭。
	for (let i = 0; i < 10; i += 1) {
		await advance(SETTLE / 2);
		await act(async () => controller.applyWheel(wheel({ deltaY: -20, ctrlKey: true })));
		expect(controller.interacting).toBe(true);
	}

	await advance(SETTLE * 2);
	expect(controller.interacting).toBe(false);
});

it("滚轮平移与托手拖拽同样算「操作中」", async () => {
	await act(async () => controller.applyWheel(wheel({ deltaY: 40 })));
	expect(controller.interacting).toBe(true);
	await advance(SETTLE * 2);
	expect(controller.interacting).toBe(false);

	await act(async () => controller.beginPan(1, 100, 100));
	expect(controller.interacting).toBe(true);
	// 拖拽途中每一帧都在 move，不会提前落回。
	for (let i = 0; i < 5; i += 1) {
		await advance(SETTLE / 2);
		await act(async () => {
			controller.panMove(1, 100 + i * 10, 100);
		});
		expect(controller.interacting).toBe(true);
	}

	await act(async () => {
		controller.endPan(1);
	});
	// 松手之后还要留一小会儿：恢复得太急，最后那几帧惯性照样撞在重新光栅化上。
	expect(controller.interacting).toBe(true);
	await advance(SETTLE * 2);
	expect(controller.interacting).toBe(false);
});

it("缩放途中只写 DOM，落定后才提交一次", async () => {
	const rendersBefore = renders;

	// 触控板一趟捏合：几十个 tick，一次 state 提交都不该有。
	for (let i = 0; i < 12; i += 1) {
		await act(async () => controller.applyWheel(wheel({ deltaY: -10, ctrlKey: true })));
		await paintFrame();
	}
	expect(commits).toEqual([]);
	// 权威值一路在走，state 快照还停在起点。
	expect(controller.viewportRef.current.zoom).toBeGreaterThan(1);
	expect(controller.viewport.zoom).toBe(1);

	// world 层已经是实时值：transform 与反向缩放变量都由 DOM 更新。
	const live = controller.viewportRef.current.zoom;
	expect(world().style.transform).toContain(`scale(${live})`);
	expect(world().style.getPropertyValue("--vetd-lscale")).toBe(String(inverseScale(live)));

	// 整趟操作里画布树最多为「拍平标记翻起来」重渲染一次，而不是每个 tick 一次。
	expect(renders - rendersBefore).toBeLessThanOrEqual(1);

	await advance(SETTLE * 2);
	expect(commits).toEqual([live]);
	expect(controller.viewport.zoom).toBe(live);
});

it("绕光标缩放：逐 tick 走 DOM 也不改变锚点不动这条", async () => {
	const anchorX = 250;
	const anchorY = 180;
	const worldPointOf = (): { x: number; y: number } => controller.toWorld(anchorX, anchorY);
	const before = worldPointOf();

	for (let i = 0; i < 8; i += 1) {
		await act(async () =>
			controller.applyWheel(wheel({ deltaY: -15, ctrlKey: true, clientX: anchorX, clientY: anchorY })),
		);
		await paintFrame();
		const now = worldPointOf();
		expect(now.x).toBeCloseTo(before.x, 6);
		expect(now.y).toBeCloseTo(before.y, 6);
	}
});
