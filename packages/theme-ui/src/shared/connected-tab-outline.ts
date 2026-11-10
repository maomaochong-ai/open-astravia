const TAB_HEIGHT = 32;
const TAB_RADIUS = 8;
const JOIN_RADIUS = 8;
/**
 * 向下盖住内容卡片那条 1px 描边所需的深度。
 * 取 2 而不是 1：描边在亚像素缩放后占 0.9～1.1px，只下探 1px 时填充边缘会与描边
 * 上沿重合，卡片线仍从激活页签中间穿过去；再深就会压到卡片内容上。
 */
const FRAME_OVERLAP = 2;

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
	// 收尾落在卡片描边**中心**而不是描边上沿：描边本身有 1px 厚，落在上沿时
	// 弧线末端与描边之间会露出一段同色的缝，看上去就是断开的。
	const baselineY = TAB_HEIGHT + FRAME_OVERLAP;
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
	const height = TAB_HEIGHT + FRAME_OVERLAP;

	return {
		fillPath: `${outlinePath} V ${height} H 0 Z`,
		height,
		offsetX: JOIN_RADIUS,
		outlinePath,
		width: outerRight,
	};
}
