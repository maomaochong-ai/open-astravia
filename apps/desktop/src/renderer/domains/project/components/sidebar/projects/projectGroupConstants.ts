import type { ProjectType } from "@shared/store/atoms";

export const DEFAULT_VISIBLE_SESSIONS = 5;
/** 侧栏会话行估算高度（含行间距），供 Virtuoso 使用。 */
export const VIRTUAL_SESSION_ROW_HEIGHT = 34;
/** Virtuoso 视口外预渲染像素，减少快速滚动白屏。 */
export const VIRTUAL_SESSION_OVERSCAN = 120;

export const PROJECT_TYPE_ICONS: Record<ProjectType, string> = {
	normal: "icon-[solar--folder-linear]",
	batch: "icon-[solar--layers-minimalistic-linear]",
};
