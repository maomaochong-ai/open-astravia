import type { AstraviaDesignFrameEntry } from "../astravia-design/manifest-types";

/**
 * 画布顺序：先左后右，同一列再从上到下。导出、预览起始帧、缩略图列表都按它排，
 * 这样「画布上看到的顺序」和「图里排出来的顺序」永远是一回事。
 */
export function byCanvasOrder(a: AstraviaDesignFrameEntry, b: AstraviaDesignFrameEntry): number {
	return a.x === b.x ? a.y - b.y : a.x - b.x;
}
