export type RendererConsoleLevel = "log" | "info" | "warn" | "error";

const LOW_SIGNAL_PREFIXES = ["[plugin-agent]", "[activity-tab-debug]", "[vite-hmr]"] as const;

/**
 * Renderer 的 console 是不可信的混合入口：既有用户操作错误，也有 HMR/插件调试输出。
 * 默认只把低信号的开发诊断挡在持久化日志之外；warn/error 始终保留。
 */
export function shouldPersistRendererConsoleMessage(
	level: RendererConsoleLevel,
	message: string,
	verbose = process.env.VETTA_RENDERER_VERBOSE_LOGS === "1",
): boolean {
	if (verbose || level === "warn" || level === "error") return true;
	if (LOW_SIGNAL_PREFIXES.some((prefix) => message.startsWith(prefix))) return false;
	if (/^\[vite\] (connecting\.\.\.|connected\.|hot updated:|invalidate )/u.test(message)) return false;
	if (/^\[theme-runtime\] (?:module |loadThemePackage |styles? |themes\.list |remote |loadRemote )/u.test(message)) {
		return false;
	}
	return true;
}
