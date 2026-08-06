/**
 * 命令面板顶部的内置连接器宫格。
 */

/**
 * 自适应列数：尽量不让最后一行只剩一个孤零零的 item。
 *
 * 用户给定的形态：2→2、3→3、4→2、5→3、6→3。这条式子全部命中，
 * 并把没给的边界补齐：1 撑满一行，7 走 4 列（4+3），8 走 3 列（3+3+2）。
 */
export function connectorGridColumns(count: number): number {
	if (count <= 2) return Math.max(count, 1);
	if (count % 3 !== 1) return 3;
	if (count % 2 === 0) return 2;
	if (count % 4 !== 1) return 4;
	return 3;
}
