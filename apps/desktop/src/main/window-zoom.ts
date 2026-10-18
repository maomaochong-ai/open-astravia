/**
 * 应用界面缩放（Electron page zoom）。
 *
 * 非 mac 平台没有菜单栏，`role: "zoomIn"` 那类菜单项不存在，所以缩放改由渲染端的
 * 可配置快捷键发起、主进程算级别。渲染端只发相对命令（in / out / reset），
 * 级别本身由 Electron 按 origin 存在 session 里，应用侧不另存一份。
 */

export type ZoomDirection = "in" | "out" | "reset";

/** Electron 的 zoom level：0 为 100%，每级约 ×1.2；0.5 级一档，和 Chromium 默认手感一致。 */
const ZOOM_LEVEL_STEP = 0.5;

/** 钉住上下限：缩到很小或放到很大之后必须还能一键回到 100%。 */
const ZOOM_LEVEL_MIN = -3;
const ZOOM_LEVEL_MAX = 3;

const ZOOM_DIRECTIONS: readonly ZoomDirection[] = ["in", "out", "reset"];

/** IPC 入参是不可信边界，先收窄再算。 */
export function isZoomDirection(value: unknown): value is ZoomDirection {
	return typeof value === "string" && (ZOOM_DIRECTIONS as readonly string[]).includes(value);
}

export function nextZoomLevel(current: number, direction: ZoomDirection): number {
	if (direction === "reset") return 0;
	const delta = direction === "in" ? ZOOM_LEVEL_STEP : -ZOOM_LEVEL_STEP;
	const next = current + delta;
	const clamped = Math.min(ZOOM_LEVEL_MAX, Math.max(ZOOM_LEVEL_MIN, next));
	// 浮点累加会积出 -0.30000000000000004 这种值，Electron 存下来后比较起来很难看。
	return Math.round(clamped * 100) / 100;
}
