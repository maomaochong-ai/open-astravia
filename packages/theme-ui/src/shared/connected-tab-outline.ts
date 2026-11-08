const TAB_HEIGHT = 32;
const TAB_RADIUS = 8;
const JOIN_RADIUS = 8;
/** 激活页签只需向下盖住内容卡片 1px 的描边，多一分就会压到卡片内容上。 */
const FRAME_OVERLAP = 1;

/**
 * 内容卡片顶边描边占 1px，它的「线心」在页签底边下方 0.5px。轮廓描边若从页签底边起笔，
 * 与卡片描边只剩半像素重叠，交界处会看到一像素接缝（视觉上的「线条断开」）。因此把
 * 几何基线固定到描边线心，让两侧肩线落笔时正好压在卡片描边的整格上。
 */
const FRAME_STROKE = 1;
const BASELINE_Y = TAB_HEIGHT + FRAME_STROKE / 2;

export interface ConnectedTabOutlineGeometry {
	fillPath: string;
	height: number;
	offsetX: number;
	outlinePath: string;
	width: number;
}

export function createConnectedTabOutlineGeometry(tabWidth: number): ConnectedTabOutlineGeometry {
	const normalizedTabWidth = Math.max(tabWidth, TAB_RADIUS * 2);
	const tabLeft = JOIN_RADIUS;
	const tabRight = tabLeft + normalizedTabWidth;
	const outerRight = tabRight + JOIN_RADIUS;
	const shoulderY = TAB_HEIGHT - JOIN_RADIUS;
	/** 卡片描边所在的一整格：填充用它把卡片顶边擦掉，页签才能与卡片连成一体。 */
	const frameTop = TAB_HEIGHT;
	/** 肩线基线：压在卡片描边线心，与描边等宽且不越过它。 */
	const baselineY = BASELINE_Y;
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
	// 擦除用的轮廓仍按页签底边（不是描边线心）起笔：这样闭合出来的是卡片顶边那一整格，
	// 半像素基线只留给描边，避免描边下方漏出 0.5px 的卡片描边。
	const erasePath = [
		`M 0 ${frameTop}`,
		`A ${JOIN_RADIUS} ${JOIN_RADIUS} 0 0 0 ${tabLeft} ${shoulderY}`,
		`V ${TAB_RADIUS}`,
		`A ${TAB_RADIUS} ${TAB_RADIUS} 0 0 1 ${tabLeft + TAB_RADIUS} 0`,
		`H ${tabRight - TAB_RADIUS}`,
		`A ${TAB_RADIUS} ${TAB_RADIUS} 0 0 1 ${tabRight} ${TAB_RADIUS}`,
		`V ${shoulderY}`,
		`A ${JOIN_RADIUS} ${JOIN_RADIUS} 0 0 0 ${outerRight} ${frameTop}`,
	].join(" ");

	return {
		fillPath: `${erasePath} V ${height} H 0 Z`,
		height,
		offsetX: JOIN_RADIUS,
		outlinePath,
		width: outerRight,
	};
}
