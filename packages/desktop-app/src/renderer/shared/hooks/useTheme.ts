import { i18n } from "@shared/i18n";
import { useAtom } from "jotai";
import { useCallback, useEffect } from "react";
import type { DesktopThemeSnapshot } from "../../../preload/api-types/theme";
import { cursorStyleAtom, resolvedThemeAtom, type ThemeMode, themeModeAtom, themeNameAtom } from "../store/atoms";
import {
	applyTheme,
	MODE_STORAGE_KEY,
	type ResolvedMode,
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

export function useTheme() {
	const [mode, setModeAtom] = useAtom(themeModeAtom);
	const [resolved, setResolved] = useAtom(resolvedThemeAtom);
	const [themeName, setThemeNameAtom] = useAtom(themeNameAtom);
	const [, setCursorStyleAtom] = useAtom(cursorStyleAtom);

	const getThemeSnapshot = useCallback((): DesktopThemeSnapshot => {
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
	}, []);

	// 挂载时与 mode 变化时同步原生窗口主题 + 解析当前 mode。
	// applyInitialTheme() 已在 main.tsx 启动时写过一次 inline style，这里只做：
	// 1) auto 模式下查询原生当前是 dark 还是 light（异步，更权威）
	// 2) 通知主进程切换 nativeTheme（影响 macOS vibrancy）
	useEffect(() => {
		async function syncWithNative() {
			let isDark: boolean;
			if (mode === "auto") {
				try {
					const native = await window.vetta.theme.getNative();
					isDark = native.shouldUseDarkColors;
				} catch {
					isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
				}
				await window.vetta.theme.set("system").catch(() => {});
			} else {
				isDark = mode === "dark";
				await window.vetta.theme.set(mode).catch(() => {});
			}
			const r: ResolvedMode = isDark ? "dark" : "light";
			const currentTheme = resolveThemeId(localStorage.getItem(THEME_STORAGE_KEY) ?? DEFAULT_THEME_ID);
			setResolved(r);
			applyTheme(r, currentTheme);
		}
		void syncWithNative();
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

	const setMode = useCallback(
		async (newMode: ThemeMode, transitionOptions?: ThemeTransitionOptions, themeNameOverride?: string) => {
			localStorage.setItem(MODE_STORAGE_KEY, newMode);

			let r: ResolvedMode;
			if (newMode === "auto") {
				await window.vetta.theme.set("system").catch(() => {});
				try {
					const native = await window.vetta.theme.getNative();
					r = native.shouldUseDarkColors ? "dark" : "light";
				} catch {
					r = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
				}
			} else {
				await window.vetta.theme.set(newMode).catch(() => {});
				r = newMode;
			}
			const nextThemeName = themeNameOverride ?? themeName;
			withThemeTransition(() => {
				setModeAtom(newMode);
				setResolved(r);
				applyTheme(r, nextThemeName);
			}, transitionOptions);
		},
		[setModeAtom, setResolved, themeName],
	);

	useEffect(() => {
		return window.vetta.theme.onModeRequested(({ mode: requestedMode }) => {
			void setMode(requestedMode);
		});
	}, [setMode]);

	const setThemeName = useCallback(
		(name: string, transitionOptions?: ThemeTransitionOptions) => {
			const nextName = resolveThemeId(name);
			localStorage.setItem(THEME_STORAGE_KEY, nextName);
			withThemeTransition(() => {
				setThemeNameAtom(nextName);
				applyTheme(resolved, nextName);
			}, transitionOptions);
		},
		[resolved, setThemeNameAtom],
	);

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
	}, [getThemeSnapshot, setCursorStyleAtom, setMode, setThemeName, setThemeNameAtom]);

	useEffect(() => {
		return window.vetta.theme.onStateRequested(getThemeSnapshot);
	}, [getThemeSnapshot]);

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
	}, [getThemeSnapshot]);

	return { mode, resolved, themeName, setMode, setThemeName };
}
