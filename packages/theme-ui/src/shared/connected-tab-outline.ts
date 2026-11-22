/** 与行高一致（`h-8`）。 */
const TAB_HEIGHT = 32;
/**
 * 页签顶部圆角。与按钮上的 `rounded-t-md`、面板上的 `rounded-tl-md` 同档（6px）：
 * 三处半径一旦不一致，接缝处就会露出一个能看出来的钝角。
 */
const TAB_RADIUS = 6;
/**
 * 页签底部的凹形连接角（向下张开、把页签接到面板上）。
 *
 * 它向外伸展的宽度就是这个值；因此行左侧内边距必须 ≥ 面板左上圆角 + 本值，
 * 否则弧线末端会落在面板的曲线段上，衔接处会出现一个折点。
 */
const JOIN_RADIUS = 6;
/**
 * 描边收尾落在卡片上边框的**中心线**上（页签高 32 + 半个 1px 描边）。
 * 落在上沿时，弧线末端与卡片线之间会露出一段同色的细缝，看上去就是断开的。
 */
const BASELINE_Y = TAB_HEIGHT + 0.5;
/**
 * 填充比描边再往下探的距离：整个 1px 上边框必须被盖住，否则激活页签中间会穿过一条线。
 * 填到描边下沿（+1px）再留 0.5px 余量。
 */
const FILL_DEPTH = 1.5;

export interface ConnectedTabOutlineGeometry {
	fillPath: string;
	height: number;
	offsetX: number;
	outlinePath: string;
	width: number;
}

/**
 * 激活页签与内容卡片之间的连接轮廓。
 *
 * 形状由三段组成：左右两侧各一个向外展开的凹形连接角（`JOIN_RADIUS`），
 * 以及页签自身的顶部圆角（`TAB_RADIUS`）。描边路径是一条开放路径，
 * 只在需要显形的三边上走线；填充路径在此基础上向下补到卡片描边里，
 * 让「页签 + 卡片」在视觉上是一整块同色区域，接缝处不会透出背景。
 */
export function createConnectedTabOutlineGeometry(tabWidth: number): ConnectedTabOutlineGeometry {
	const normalizedTabWidth = Math.max(tabWidth, TAB_RADIUS * 2);
	const tabLeft = JOIN_RADIUS;
	const tabRight = tabLeft + normalizedTabWidth;
	const outerRight = tabRight + JOIN_RADIUS;
	const baselineY = BASELINE_Y;
	const shoulderY = baselineY - JOIN_RADIUS;
	const outlinePath = [
		`M 0 ${baselineY}`,
		`A ${JOIN_RADIUS} ${JOIN_RADIUS} 0 0 0 ${tabLeft} ${shoulderY}`,
		`V ${TAB_RADIUS}`,
		`A ${TAB_RADIUS} ${TAB_RADIUS} 0 0 1 ${tabLeft + TAB_RADIUS} 0`,
		`H ${tabRight - TAB_RADIUS}`,
		`A ${TAB_RADIUS} ${TAB_RADIUS} 0 0 1 ${tabRight} ${TAB_RADIUS}`,
		`V ${shoulderY}`,
		`A ${JOIN_RADIUS} ${JOIN_RADIUS} 0 0 0 ${outerRight} ${baselineY}`,
	].join(" ");
	const height = baselineY + FILL_DEPTH;

	return {
		fillPath: `${outlinePath} V ${height} H 0 Z`,
		height,
		offsetX: JOIN_RADIUS,
		outlinePath,
		width: outerRight,
	};
}
