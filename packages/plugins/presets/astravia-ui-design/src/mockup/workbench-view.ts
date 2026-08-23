/**
 * 工作台预览区的多页堆叠。
 *
 * 视图的平移/缩放不在这里：工作台与编辑态画布共用 `canvas/use-viewport`
 * （滚轮平移、Ctrl/⌘+滚轮绕光标缩放、rAF 折叠、落定回 state），两处各写
 * 一遍手势逻辑必然漂开。这里只剩纯几何——页面怎么在世界坐标里摆。
 *
 * 世界坐标 = layout.ts 的 layout unit；屏幕坐标 = 世界坐标 * zoom + 平移量。
 */
import type { Viewport } from "../canvas/use-viewport";

export interface Size {
	width: number;
	height: number;
}

export interface PageBox extends Size {
	left: number;
	top: number;
}

/** 保持缩放比，把内容重新摆到容器中央（「实际大小」按钮用）。 */
export function centerViewport(world: Size, viewport: Size, zoom: number): Viewport {
	return {
		zoom,
		x: (viewport.width - world.width * zoom) / 2,
		y: (viewport.height - world.height * zoom) / 2,
	};
}

/**
 * 多页竖向堆叠，逐页水平居中——最后一页画框数常常更少、因而更窄，
 * 左对齐会让整叠图看着像歪了。
 */
export function stackPages(sizes: readonly Size[], gap: number): { world: Size; boxes: PageBox[] } {
	if (sizes.length === 0) return { world: { width: 0, height: 0 }, boxes: [] };
	const width = Math.max(...sizes.map((size) => size.width));
	const boxes: PageBox[] = [];
	let top = 0;
	for (const size of sizes) {
		boxes.push({ left: (width - size.width) / 2, top, width: size.width, height: size.height });
		top += size.height + gap;
	}
	return { world: { width, height: Math.max(0, top - gap) }, boxes };
}
