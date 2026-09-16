const TAB_HEIGHT = 32;
const TAB_RADIUS = 8;
const JOIN_RADIUS = 8;
/** 激活页签只需向下盖住内容卡片 1px 的描边，多一分就会压到卡片内容上。 */
const FRAME_OVERLAP = 1;

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
	const outlinePath = [
		`M 0 ${TAB_HEIGHT}`,
		`A ${JOIN_RADIUS} ${JOIN_RADIUS} 0 0 0 ${tabLeft} ${shoulderY}`,
		`V ${TAB_RADIUS}`,
		`A ${TAB_RADIUS} ${TAB_RADIUS} 0 0 1 ${tabLeft + TAB_RADIUS} 0`,
		`H ${tabRight - TAB_RADIUS}`,
		`A ${TAB_RADIUS} ${TAB_RADIUS} 0 0 1 ${tabRight} ${TAB_RADIUS}`,
		`V ${shoulderY}`,
		`A ${JOIN_RADIUS} ${JOIN_RADIUS} 0 0 0 ${outerRight} ${TAB_HEIGHT}`,
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
