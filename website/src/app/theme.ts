import { useEffect, useState } from "react";

/** 主题只有两档，存 localStorage；首帧由 index.html 的内联脚本先定住。 */
export type Theme = "light" | "dark";

const THEME_KEY = "astravia-theme";

function readTheme(): Theme {
	const stored = document.documentElement.dataset.theme;
	if (stored === "light" || stored === "dark") return stored;
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() {
	const [theme, setThemeState] = useState<Theme>(readTheme);

	useEffect(() => {
		// 一次换完，不做颜色过渡：半透明表面逐层插值会闪白，也会让切换显得迟滞。
		document.documentElement.dataset.theme = theme;
		document
			.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
			?.setAttribute("content", theme === "dark" ? "#0d0d0d" : "#ffffff");
	}, [theme]);

	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = (event: MediaQueryListEvent) => {
			if (localStorage.getItem(THEME_KEY)) return;
			setThemeState(event.matches ? "dark" : "light");
		};
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, []);

	const setTheme = (next: Theme) => {
		localStorage.setItem(THEME_KEY, next);
		setThemeState(next);
	};

	return {
		theme,
		toggle: () => setTheme(theme === "dark" ? "light" : "dark"),
	};
}
