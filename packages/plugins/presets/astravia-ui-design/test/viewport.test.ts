/**
 * 视口数学（编辑态画布与只读预览画布共用，见 src/canvas/use-viewport.ts）。
 * 这里测的是两处都依赖的不变量：绕定点缩放时锚点不动、fit 后内容完整可见且居中。
 */
import { expect, it } from "vitest";
import { clampZoom, fitViewport, MAX_ZOOM, MIN_ZOOM, zoomAround } from "../src/canvas/use-viewport";

/** 容器内坐标 → 世界坐标（与 useViewport.toWorld 同一条换算）。 */
function toWorld(viewport: { x: number; y: number; zoom: number }, localX: number, localY: number) {
	return { x: (localX - viewport.x) / viewport.zoom, y: (localY - viewport.y) / viewport.zoom };
}

it("keeps the anchor point fixed while zooming", () => {
	const current = { x: -120, y: 40, zoom: 0.75 };
	const before = toWorld(current, 300, 200);
	const after = toWorld(zoomAround(current, 1.8, 300, 200), 300, 200);
	expect(after.x).toBeCloseTo(before.x, 6);
	expect(after.y).toBeCloseTo(before.y, 6);
});

it("clamps zoom at both ends, anchor still fixed", () => {
	const current = { x: 0, y: 0, zoom: 1 };
	expect(zoomAround(current, 1000, 50, 50).zoom).toBe(MAX_ZOOM);
	expect(zoomAround(current, 0.000001, 50, 50).zoom).toBe(MIN_ZOOM);
	expect(clampZoom(2)).toBe(2);
	const clamped = zoomAround(current, 1000, 50, 50);
	expect(toWorld(clamped, 50, 50)).toEqual(toWorld(current, 50, 50));
});

it("fits content inside the container with padding, centred", () => {
	const content = { x: 100, y: 100, width: 800, height: 400 };
	const size = { width: 500, height: 500 };
	const viewport = fitViewport(content, size, 20);
	if (!viewport) throw new Error("expected a viewport");
	// 460 可用宽度 / 800 内容宽度：宽度是短边，所以由它定缩放。
	expect(viewport.zoom).toBeCloseTo(460 / 800, 6);
	const topLeft = toWorld(viewport, 0, 0);
	const bottomRight = toWorld(viewport, size.width, size.height);
	expect(topLeft.x).toBeLessThanOrEqual(content.x);
	expect(topLeft.y).toBeLessThanOrEqual(content.y);
	expect(bottomRight.x).toBeGreaterThanOrEqual(content.x + content.width);
	expect(bottomRight.y).toBeGreaterThanOrEqual(content.y + content.height);
	// 居中：两侧留白相等。
	expect(content.x - topLeft.x).toBeCloseTo(bottomRight.x - (content.x + content.width), 6);
});

it("never enlarges past 1:1 by default", () => {
	const viewport = fitViewport({ x: 0, y: 0, width: 100, height: 100 }, { width: 1000, height: 1000 }, 20);
	expect(viewport?.zoom).toBe(1);
});

it("returns null when there is nothing to fit or the container is unmeasured", () => {
	expect(fitViewport(null, { width: 100, height: 100 }, 20)).toBeNull();
	expect(fitViewport({ x: 0, y: 0, width: 0, height: 0 }, { width: 100, height: 100 }, 20)).toBeNull();
	expect(fitViewport({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 0 }, 20)).toBeNull();
});
