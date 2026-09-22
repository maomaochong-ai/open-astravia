import { useUniwind } from "uniwind";
import { palette, type ThemeName } from "./colors";

export function useTheme() {
	const { theme } = useUniwind();
	const name: ThemeName = theme === "light" ? "light" : "dark";
	return { name, colors: palette[name], isDark: name === "dark" };
}
