import { createAppAssetUrl } from "@/shared/app-asset-protocol";

export type CursorStyle = "default" | "stoat";

/** 当前使用的存储键：值是 CursorStyle。 */
export const CURSOR_STORAGE_KEY = "vetta-cursor-style";

/** 白鼬鼠标预览资源；固定应用资源协议，兼容开发与打包环境。 */
export const STOAT_CURSOR_PREVIEW_URL = createAppAssetUrl("renderer", "cursors/default.png");

/** 旧开关键（true/false），读取时兼容迁移。 */
export const LEGACY_CURSOR_STORAGE_KEY = "vetta-custom-cursor";

const CURSOR_STOAT_CLASS = "custom-cursor";

export function isCursorStyle(value: string | null | undefined): value is CursorStyle {
	return value === "default" || value === "stoat";
}

export function getStoredCursorStyle(): CursorStyle {
	const stored = localStorage.getItem(CURSOR_STORAGE_KEY);
	if (isCursorStyle(stored)) return stored;

	// 兼容旧版布尔开关：true → 白鼬，其余 → 默认
	if (localStorage.getItem(LEGACY_CURSOR_STORAGE_KEY) === "true") {
		return "stoat";
	}
	return "default";
}

export function applyCursorStyle(style: CursorStyle): void {
	document.documentElement.classList.toggle(CURSOR_STOAT_CLASS, style === "stoat");
}

export function setStoredCursorStyle(style: CursorStyle): void {
	localStorage.setItem(CURSOR_STORAGE_KEY, style);
	localStorage.removeItem(LEGACY_CURSOR_STORAGE_KEY);
	applyCursorStyle(style);
}

export function applyStoredCursorStyle(): void {
	applyCursorStyle(getStoredCursorStyle());
}

/** @deprecated 使用 applyStoredCursorStyle */
export const applyStoredCustomCursor = applyStoredCursorStyle;
