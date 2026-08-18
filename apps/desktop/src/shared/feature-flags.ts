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

/** Vetta 云服务（登录 / 订阅 / 远程模型等增值能力）：构建期开关。 */
export const CLOUD_ENABLED_ENV = "VETTA_CLOUD_ENABLED";

/**
 * 云服务是否编入本构建。默认开启（完全体）；`VETTA_CLOUD_ENABLED=false` 产出 lite 构建，
 * 相关代码经构建期常量折叠后不进产物，发布后不能由运行环境重新开启。
 */
export function isCloudBuildEnabled(): boolean {
	return process.env.VETTA_CLOUD_ENABLED !== "false";
}
