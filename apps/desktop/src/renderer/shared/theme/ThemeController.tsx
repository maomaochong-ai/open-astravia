import { useThemeController } from "../hooks/useTheme";

/** 将全局主题 IPC、系统模式监听与 atom 同步收敛到唯一挂载点。 */
export function ThemeController(): null {
	useThemeController();
	return null;
}
