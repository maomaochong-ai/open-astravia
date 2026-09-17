/**
 * 「这一趟缩放/平移还在进行」这个信号（ViewportController.interacting）。
 *
 * 画布据它把自己拍平：冷启动时每个还没截到位图的画框都盖着一层 26px 模糊 + 无限旋转的
 * 流体占位，全都套在 world 的 scale 底下，缩放每变一档就得整层重新光栅化。操作期间摘掉
 * 它们，结束再恢复。这里守两条：一趟操作里只翻一次（中途不能亮灭），以及一定会自己落回。
 */
import { act, createElement, type JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useViewport, type ViewportController } from "../src/canvas/use-viewport";

/** INTERACT_SETTLE_MS 的镜像：测试只需要「大于静置时间」，不必逐字节同步。 */
const SETTLE = 220;

let controller: ViewportController;
let root: Root;
let host: HTMLElement;

function Harness(): JSX.Element {
	const view = useViewport({ initial: { x: 0, y: 0, zoom: 1 } });
	controller = view;
	return createElement(
		"div",
		{ ref: view.containerRef, style: { width: "800px", height: "600px" } },
		createElement("div", { ref: view.worldRef }),
	);
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
