/**
 * 内容高度超过离屏窗口上限时的分块方案：滚动容器每翻一页截一块，再按行拼成一张。
 *
 * 纯计算，与截图和画布都无关，好单独验证「拼出来正好是完整内容、不多不少不重叠」。
 * 所有量都是 CSS px，绘制时再乘设备像素比。
 */

export interface TileSource {
	/** 视口高度：每块位图的高。 */
	viewportHeight: number;
	/** 滚动容器在视口里的可见区；文档滚动时就是 [0, viewportHeight)。 */
	top: number;
	bottom: number;
	/** 可见区之外还藏着多少内容。 */
	hidden: number;
}

export interface Tile {
	/** 截这一块之前把滚动容器滚到哪。 */
	scrollTop: number;
	/** 从这一块位图里取哪几行（视口坐标，[srcTop, srcBottom)）。 */
	srcTop: number;
	srcBottom: number;
	/** 取出的行落到整图的哪一行。 */
	destTop: number;
}

export interface TilePlan {
	/** 拼出的整图高度。 */
	height: number;
	tiles: Tile[];
}

/**
 * 整图 = 容器上方的固定部分（随第一块）+ 容器的全部内容（逐块）+ 容器下方的固定部分（随最后一块）。
 *
 * 容器内容行 y 在 scrollTop = s 的那一块里位于视口行 top + (y - s)。每块推进一个可见
 * 高度；最后一块滚到底（scrollHeight - clientHeight），和上一块重叠的行从 srcTop 里
 * 裁掉，所以每一行内容只出现一次。
 */
export function planTiles(source: TileSource): TilePlan {
	const viewportHeight = Math.round(source.viewportHeight);
	const top = Math.round(source.top);
	const clientHeight = Math.max(1, Math.round(source.bottom) - top);
	const hidden = Math.max(0, Math.round(source.hidden));
	const contentHeight = clientHeight + hidden;
	const height = viewportHeight + hidden;
	if (hidden === 0) {
		return { height, tiles: [{ scrollTop: 0, srcTop: 0, srcBottom: viewportHeight, destTop: 0 }] };
	}

	const tiles: Tile[] = [];
	// 第一块：从视口顶端一直取到容器可见区底部（容器上方的固定部分跟着进来）。
	tiles.push({ scrollTop: 0, srcTop: 0, srcBottom: top + clientHeight, destTop: 0 });
	let covered = clientHeight; // 已拼进整图的容器内容行数
	while (covered < contentHeight) {
		const scrollTop = Math.min(covered, contentHeight - clientHeight);
		// 滚到底那一块与上一块重叠 (covered - scrollTop) 行，从头裁掉。
		const overlap = covered - scrollTop;
		const rows = Math.min(clientHeight - overlap, contentHeight - covered);
		tiles.push({
			scrollTop,
			srcTop: top + overlap,
			srcBottom: top + overlap + rows,
			destTop: top + covered,
		});
		covered += rows;
	}
	// 最后一块顺带把容器下方的固定部分（底部 tab 之类）带上：它在视口里紧接着容器
	// 可见区之下，在整图里也紧接着最后一行内容。
	const last = tiles[tiles.length - 1];
	if (last) last.srcBottom = viewportHeight;
	return { height, tiles };
}
