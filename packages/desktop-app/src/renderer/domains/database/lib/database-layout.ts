/**
 * 三栏经典数据库工具视图的响应式布局计算（B2.6-R 自适应优化）。
 *
 * 活动面板宽度可拖拽到 260px 起，而三栏固定 280 + 320px 在窄面板下必然溢出，
 * 因此按面板宽度分档降级：
 * - wide（≥880）：三栏 inline（连接树 + 查询/结果 + 连接详情）
 * - medium（≥560）：两栏 inline（连接树 + 查询/结果），详情收起为浮层
 * - narrow（<560）：单栏（查询/结果），树与详情均收起为浮层
 *
 * 纯函数以便单测；组件内再按 mode 映射 padding/gap 等样式类。
 */
export type DatabaseLayoutMode = "wide" | "medium" | "narrow";

export interface DatabaseLayout {
	mode: DatabaseLayoutMode;
	/** 该宽度下连接树是否应自动 inline 显示。 */
	autoTree: boolean;
	/** 该宽度下连接详情是否应自动 inline 显示。 */
	autoDetails: boolean;
}

export const DATABASE_LAYOUT_TREE_BREAKPOINT = 560;
export const DATABASE_LAYOUT_DETAILS_BREAKPOINT = 880;

export function resolveDatabaseLayout(width: number): DatabaseLayout {
	const mode: DatabaseLayoutMode =
		width >= DATABASE_LAYOUT_DETAILS_BREAKPOINT
			? "wide"
			: width >= DATABASE_LAYOUT_TREE_BREAKPOINT
				? "medium"
				: "narrow";
	return {
		mode,
		autoTree: width >= DATABASE_LAYOUT_TREE_BREAKPOINT,
		autoDetails: width >= DATABASE_LAYOUT_DETAILS_BREAKPOINT,
	};
}
