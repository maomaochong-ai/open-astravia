import { DEFAULT_THEME_ID, resolveThemeId } from "@shared/theme/themes";
import { atom } from "jotai";
import type { ReactNode } from "react";
import {
	type AppLanguage,
	DEFAULT_LANGUAGE,
	DEFAULT_LANGUAGE_PREFERENCE,
	isLanguagePreference,
	isSupportedLanguage,
	type LanguagePreference,
} from "@/shared/i18n/config";
import { type CursorStyle, getStoredCursorStyle } from "../theme/cursor";

// ─── i18n ───
// 初值取主进程同步暴露的语言状态（preference + 解析后 language）。
// 切换写主进程，见 useLanguage。
const initialState = typeof window !== "undefined" ? window.vetta?.i18n?.initialState : undefined;
const initialPreference: LanguagePreference = isLanguagePreference(initialState?.preference)
	? initialState.preference
	: isLanguagePreference(typeof window !== "undefined" ? window.vetta?.i18n?.initialLanguagePreference : undefined)
		? (window.vetta!.i18n.initialLanguagePreference as LanguagePreference)
		: DEFAULT_LANGUAGE_PREFERENCE;
const initialResolved: AppLanguage = isSupportedLanguage(initialState?.language)
	? initialState.language
	: isSupportedLanguage(typeof window !== "undefined" ? window.vetta?.i18n?.initialLanguage : undefined)
		? (window.vetta!.i18n.initialLanguage as AppLanguage)
		: DEFAULT_LANGUAGE;

/** 用户语言偏好（含 system）；设置/引导页选中态。 */
export const languagePreferenceAtom = atom<LanguagePreference>(initialPreference);
/** 解析后的实际界面语言（i18next lng）。 */
export const languageAtom = atom<AppLanguage>(initialResolved);

// ─── Page header overrides ───
// Pages can set these to override the default route-based title and inject
// custom right-side action buttons into the global PageHeader.
export const pageHeaderTitleAtom = atom<string | null>(null);
export const pageHeaderRightSlotAtom = atom<ReactNode | null>(null);
/** 顶栏左侧（侧边栏触发按钮之后、标题之前）的自定义插槽，如设置页的返回按钮。 */
export const pageHeaderLeftSlotAtom = atom<ReactNode | null>(null);
/** 紧贴顶栏标题 label 右侧的徽标插槽（如知识库「正在建立索引…」）。 */
export const pageHeaderTitleBadgeAtom = atom<ReactNode | null>(null);
// 设为 true 时彻底隐藏顶栏标题（连路由兜底标题也不显示），用于 NewSessionPage 等。
export const pageHeaderTitleHiddenAtom = atom<boolean>(false);

// ─── Settings page ───

export type SettingsTab =
	| "general"
	| "appearance"
	| "account"
	| "models"
	| "mcp"
	| "environment"
	| "permissions"
	| "im"
	| "webhook"
	| "shortcuts"
	| "appshot"
	| "archive"
	| "team"
	| "context"
	| "plugins"
	| "knowledge"
	| "pet";

// ─── Theme ───

export type ThemeMode = "light" | "dark" | "auto";
export const themeModeAtom = atom<ThemeMode>((localStorage.getItem("vetta-theme") as ThemeMode) || "dark");
export const resolvedThemeAtom = atom<"light" | "dark">("dark");
export const themeNameAtom = atom<string>(
	resolveThemeId(localStorage.getItem("vetta-color-theme") || DEFAULT_THEME_ID),
);
export type { CursorStyle };
export const cursorStyleAtom = atom<CursorStyle>(getStoredCursorStyle());

// ─── Confirm dialog ───

export interface ConfirmDialogState {
	title: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	checkbox?: {
		label: string;
		checked: boolean;
	};
	variant?: "danger" | "default";
	onConfirm: (checkboxChecked: boolean) => void;
	onCancel?: () => void;
}

export const confirmDialogAtom = atom<ConfirmDialogState | null>(null);

export interface SandboxPermissionDrawerState {
	requestId: string;
	title: string;
	message: string;
	/** True when the request is for a sensitive deny-root path; UI must hide the "allow for session" button. */
	sensitive?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
	onAllowSession?: () => void;
}

export const sandboxPermissionDrawerAtom = atom<SandboxPermissionDrawerState | null>(null);
