import { i18n } from "@shared/i18n";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";
import type { DesktopThemeSnapshot } from "../../../preload/api-types/theme";
import { cursorStyleAtom, resolvedThemeAtom, type ThemeMode, themeModeAtom, themeNameAtom } from "../store/atoms";
import {
	applyTheme,
	MODE_STORAGE_KEY,
	type ResolvedMode,
	resolveThemeMode,
	THEME_STORAGE_KEY,
	type ThemeTransitionOptions,
	withThemeTransition,
} from "../theme/apply";
import { getStoredCursorStyle, setStoredCursorStyle } from "../theme/cursor";
import { DEFAULT_THEME_ID, resolveThemeId, THEMES } from "../theme/themes";

const COLOR_THEME_LABEL_KEYS = {
	mono: "colorThemes.mono",
	default: "colorThemes.default",
	sand: "colorThemes.sand",
} as const;

function getThemeSnapshot(): DesktopThemeSnapshot {
	const storedMode = localStorage.getItem(MODE_STORAGE_KEY);
	const storedThemeId = localStorage.getItem(THEME_STORAGE_KEY);
	const root = document.documentElement;
	const resolvedMode = root.getAttribute("data-mode");
	return {
		mode: storedMode === "light" || storedMode === "dark" || storedMode === "auto" ? storedMode : "dark",
		themeId: resolveThemeId(storedThemeId && storedThemeId.length > 0 ? storedThemeId : DEFAULT_THEME_ID),
		resolved: resolvedMode === "light" || resolvedMode === "dark" ? resolvedMode : null,
		appliedThemeId: root.getAttribute("data-theme"),
		cursorStyle: getStoredCursorStyle(),
	};
}

export interface ThemeActions {
	setMode: (
		newMode: ThemeMode,
		transitionOptions?: ThemeTransitionOptions,
		themeNameOverride?: string,
	) => Promise<void>;
	setThemeName: (name: string, transitionOptions?: ThemeTransitionOptions) => void;
}

/**
 * 只暴露稳定写操作，不订阅主题 atom。
 * 根布局、桥接器等只需要发起切换的调用方不会再因主题变化整棵重渲染。
 */
export function useThemeActions(): ThemeActions {
	const setModeAtom = useSetAtom(themeModeAtom);
	const setResolved = useSetAtom(resolvedThemeAtom);
	const setThemeNameAtom = useSetAtom(themeNameAtom);

	const setMode = useCallback(
		(newMode: ThemeMode, transitionOptions?: ThemeTransitionOptions, themeNameOverride?: string): Promise<void> => {
			localStorage.setItem(MODE_STORAGE_KEY, newMode);
			const resolved = resolveThemeMode(newMode);
			const nextThemeName = resolveThemeId(
				themeNameOverride ?? localStorage.getItem(THEME_STORAGE_KEY) ?? DEFAULT_THEME_ID,
			);

			// 页面颜色必须立即响应点击；nativeTheme / vibrancy 通过唯一的控制器异步跟进。
			withThemeTransition(() => {
				setModeAtom(newMode);
				setResolved(resolved);
				applyTheme(resolved, nextThemeName);
			}, transitionOptions);
			return Promise.resolve();
		},
		[setModeAtom, setResolved],
	);

	const setThemeName = useCallback(
		(name: string, transitionOptions?: ThemeTransitionOptions) => {
			const nextName = resolveThemeId(name);
			const appliedMode = document.documentElement.getAttribute("data-mode");
			const resolved =
				appliedMode === "light" || appliedMode === "dark"
					? appliedMode
					: resolveThemeMode((localStorage.getItem(MODE_STORAGE_KEY) as ThemeMode | null) ?? "dark");
			localStorage.setItem(THEME_STORAGE_KEY, nextName);
			withThemeTransition(() => {
				setThemeNameAtom(nextName);
				applyTheme(resolved, nextName);
			}, transitionOptions);
		},
		[setThemeNameAtom],
	);

	return useMemo(() => ({ setMode, setThemeName }), [setMode, setThemeName]);
}

export function useTheme() {
	const mode = useAtomValue(themeModeAtom);
	const resolved = useAtomValue(resolvedThemeAtom);
	const themeName = useAtomValue(themeNameAtom);
	const { setMode, setThemeName } = useThemeActions();

	return { mode, resolved, themeName, setMode, setThemeName };
}

/** 全局主题生命周期。只能由应用根部的 ThemeController 挂载一次。 */
export function useThemeController(): void {
	const mode = useAtomValue(themeModeAtom);
	const setResolved = useSetAtom(resolvedThemeAtom);
	const setThemeNameAtom = useSetAtom(themeNameAtom);
	const setCursorStyleAtom = useSetAtom(cursorStyleAtom);
	const { setMode, setThemeName } = useThemeActions();

	// applyInitialTheme() 已在 React 挂载前完成页面着色。这里仅异步同步 nativeTheme，
	// auto 模式再用原生结果校正 matchMedia 的同步预估。
	useEffect(() => {
		let cancelled = false;
		async function syncWithNative() {
			if (mode !== "auto") {
				setResolved(mode);
				await window.vetta.theme.set(mode).catch(() => {});
				return;
			}

			await window.vetta.theme.set("system").catch(() => {});
			let resolved: ResolvedMode;
			try {
				const native = await window.vetta.theme.getNative();
				resolved = native.shouldUseDarkColors ? "dark" : "light";
			} catch {
				resolved = resolveThemeMode("auto");
			}
			if (cancelled || localStorage.getItem(MODE_STORAGE_KEY) !== "auto") return;
			const currentTheme = resolveThemeId(localStorage.getItem(THEME_STORAGE_KEY) ?? DEFAULT_THEME_ID);
			setResolved(resolved);
			applyTheme(resolved, currentTheme);
		}
		void syncWithNative();
		return () => {
			cancelled = true;
		};
	}, [mode, setResolved]);

	// 监听原生主题变化（auto 模式下才响应）。
	useEffect(() => {
		const unsubscribe = window.vetta.theme.onNativeChanged((info) => {
			const current = (localStorage.getItem(MODE_STORAGE_KEY) as ThemeMode | null) ?? "dark";
			if (current !== "auto") return;
			const r: ResolvedMode = info.shouldUseDarkColors ? "dark" : "light";
			const currentTheme = resolveThemeId(localStorage.getItem(THEME_STORAGE_KEY) ?? DEFAULT_THEME_ID);
			setResolved(r);
			applyTheme(r, currentTheme);
		});
		return unsubscribe;
	}, [setResolved]);

	useEffect(() => {
		return window.vetta.theme.onModeRequested(({ mode: requestedMode }) => {
			void setMode(requestedMode);
		});
	}, [setMode]);

	useEffect(() => {
		return window.vetta.theme.onChangeRequested(async ({ mode: requestedMode, themeId, cursorStyle }) => {
			if (cursorStyle !== undefined) {
				setStoredCursorStyle(cursorStyle);
				setCursorStyleAtom(cursorStyle);
			}
			if (requestedMode !== undefined) {
				if (typeof themeId === "string") {
					const nextThemeId = resolveThemeId(themeId);
					localStorage.setItem(THEME_STORAGE_KEY, nextThemeId);
					setThemeNameAtom(nextThemeId);
					await setMode(requestedMode, undefined, nextThemeId);
					return getThemeSnapshot();
				}
				await setMode(requestedMode, undefined, themeId);
				return getThemeSnapshot();
			}
			if (typeof themeId === "string") {
				setThemeName(themeId);
			}
			return getThemeSnapshot();
		});
	}, [setCursorStyleAtom, setMode, setThemeName, setThemeNameAtom]);

	useEffect(() => {
		return window.vetta.theme.onStateRequested(getThemeSnapshot);
	}, []);

	useEffect(() => {
		return window.vetta.theme.onHelpRequested(() => ({
			state: getThemeSnapshot(),
			themes: THEMES.map(({ id, label }) => {
				const labelKey = COLOR_THEME_LABEL_KEYS[id as keyof typeof COLOR_THEME_LABEL_KEYS];
				return {
					id,
					label: labelKey ? i18n.t(`settings:${labelKey}`) : label,
				};
			}),
		}));
	}, []);
}
