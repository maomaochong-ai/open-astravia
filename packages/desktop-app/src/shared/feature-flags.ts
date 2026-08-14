/**
 * Feature flags driven by environment variables.
 *
 * Renderer: values are inlined at Vite build/dev start via `vite.config.ts` define.
 * Main: reads `process.env` at runtime (also inlined when present in `.env.<mode>` via main Vite define).
 */

/** 外观设置「界面主题」区段：默认不展示；`VETTA_SHOW_UI_THEME=true` 时展示。 */
export const APPEARANCE_UI_THEME_ENV = "VETTA_SHOW_UI_THEME";

export function isAppearanceUiThemeEnabled(): boolean {
	return process.env.VETTA_SHOW_UI_THEME === "true";
}

/** Windows 本地语音输入：构建期开关，发布后不能由运行环境重新开启。 */
export function isSpeechInputBuildEnabled(): boolean {
	return process.env.VETTA_SPEECH_INPUT_ENABLED === "true";
}
