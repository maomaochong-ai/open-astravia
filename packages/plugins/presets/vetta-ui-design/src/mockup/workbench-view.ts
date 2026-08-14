/**
 * 工作台预览区的自由缩放/平移，以及多页在「世界坐标」里的堆叠。
 *
 * 全是纯函数：视图变换和页面堆叠是这个工作台里最容易算错、也最难靠肉眼验的
 * 部分（光标锚点、fit 留白、页宽不一致时的居中），单独放出来才能直接测。
 *
 * 世界坐标 = layout.ts 的 layout unit；屏幕坐标 = 世界坐标 * scale + 平移量。
 */

export interface ViewTransform {
	scale: number;
	/** 世界原点在容器里的屏幕位置。 */
	x: number;
	y: number;
}

export interface Size {
	width: number;
	height: number;
}

export interface PageBox extends Size {
	left: number;
	top: number;
}

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 4;

export function clampScale(scale: number): number {
	if (!Number.isFinite(scale)) return 1;
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * 整份内容居中铺满容器。不放大到 1 以上：渲染图本来就是高分辨率合成图，
 * 一进来就被拉过 100% 只会让人以为它糊了。
 */
export function fitView(world: Size, viewport: Size, padding = 24): ViewTransform {
	if (world.width <= 0 || world.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
		return { scale: 1, x: 0, y: 0 };
	}
	const usableWidth = Math.max(1, viewport.width - padding * 2);
	const usableHeight = Math.max(1, viewport.height - padding * 2);
	const scale = clampScale(Math.min(usableWidth / world.width, usableHeight / world.height, 1));
	return centerView(world, viewport, scale);
}

/** 保持缩放比，把内容重新摆到容器中央。 */
export function centerView(world: Size, viewport: Size, scale: number): ViewTransform {
	return {
		scale,
		x: (viewport.width - world.width * scale) / 2,
		y: (viewport.height - world.height * scale) / 2,
	};
}

/** 以容器内某点为锚缩放：该点下的世界坐标保持不动。 */
export function zoomAt(view: ViewTransform, factor: number, point: { x: number; y: number }): ViewTransform {
	const scale = clampScale(view.scale * factor);
	// 撞到上下限时 factor 不能全额兑现，用实际比值算平移才不会漂。
	const applied = scale / view.scale;
	return {
		scale,
		x: point.x - (point.x - view.x) * applied,
		y: point.y - (point.y - view.y) * applied,
	};
}

export function panBy(view: ViewTransform, dx: number, dy: number): ViewTransform {
	return { scale: view.scale, x: view.x + dx, y: view.y + dy };
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
