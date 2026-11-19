// 界面缩放（设置 → 外观 → 界面大小）。主进程持久化并应用，renderer 只读写同一个比例。
//
// 档位是固定的一列而不是自由步进：快捷键、滑块、下拉都只在这些值之间移动，
// 「放大一点」的结果不取决于用户上次拖到哪儿。

/** 可选的缩放档位。滑块、Cmd/Ctrl +/- 都只在这些档位间移动。 */
export const UI_ZOOM_STEPS = [0.75, 0.9, 1, 1.1, 1.25, 1.5] as const;
export const UI_ZOOM_DEFAULT = 1;

/** 吸附到最近的档位；两档正中时取较小的。非有限数回落默认值，兼容旧配置里的任意比例。 */
export function normalizeUiZoomFactor(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return UI_ZOOM_DEFAULT;
	let nearest: number = UI_ZOOM_STEPS[0];
	for (const step of UI_ZOOM_STEPS) {
		if (Math.abs(step - value) < Math.abs(nearest - value)) nearest = step;
	}
	return nearest;
}

export function uiZoomStepIndex(factor: number): number {
	return UI_ZOOM_STEPS.indexOf(normalizeUiZoomFactor(factor) as (typeof UI_ZOOM_STEPS)[number]);
}

/** 在当前档位上走 `direction` 档（快捷键用），到头不越界。 */
export function stepUiZoomFactor(current: number, direction: 1 | -1): number {
	const next = Math.min(UI_ZOOM_STEPS.length - 1, Math.max(0, uiZoomStepIndex(current) + direction));
	return UI_ZOOM_STEPS[next] ?? UI_ZOOM_DEFAULT;
}

/** 红绿灯左缘距窗口的屏幕像素。 */
const TRAFFIC_LIGHT_X = 16;
/**
 * 原生按钮的 y 是框顶，视觉中心在其下方（屏幕 px）。macOS 红绿灯彩色圆约 12pt，
 * 框顶到圆心约 8pt，再上提 1pt 与页头图标的视觉中线对齐，故取 9。
 * 按钮本身不随页面缩放，所以这是常数；页头怎么排由渲染进程实测上报。
 */
const TRAFFIC_LIGHT_CENTER_OFFSET = 9;
/** 渲染进程还没上报实测中线时的兜底（CSS px），等于 100% 缩放下页头的标定中线。 */
export const TITLEBAR_CENTER_FALLBACK = 28;

/** 校验渲染进程上报的页头中线（CSS px）：非有限数或越界一律丢弃。 */
export function parseTitlebarCenter(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return value >= 0 && value <= 200 ? value : undefined;
}

/**
 * 红绿灯是原生控件，不随网页缩放；页头中线是 CSS px，换算成屏幕 px 要乘缩放比。
 * 中线由渲染进程实测上报，所以页头高度、内边距、沉浸式页头怎么变，这里都不需要改数字。
 */
export function trafficLightPositionFor(centerCssPx: number, factor: number | undefined): { x: number; y: number } {
	return {
		x: TRAFFIC_LIGHT_X,
		y: Math.round(centerCssPx * normalizeUiZoomFactor(factor) - TRAFFIC_LIGHT_CENTER_OFFSET),
	};
}

/** 渲染进程实测缩放与期望档位的容差；Chromium 内部按 zoom level 换算，会带浮点误差。 */
const ZOOM_MISMATCH_TOLERANCE = 0.005;

/** 实测缩放是否偏离期望档位，偏离就该纠正。实测值非法（取不到）时不动，避免乱写。 */
export function uiZoomNeedsCorrection(actual: unknown, desired: number): boolean {
	if (typeof actual !== "number" || !Number.isFinite(actual) || actual <= 0) return false;
	return Math.abs(actual - normalizeUiZoomFactor(desired)) > ZOOM_MISMATCH_TOLERANCE;
}

/** 界面缩放的百分比文案，如 1.1 → "110%"。 */
export function formatUiZoomPercent(factor: number): string {
	return `${Math.round(normalizeUiZoomFactor(factor) * 100)}%`;
}
