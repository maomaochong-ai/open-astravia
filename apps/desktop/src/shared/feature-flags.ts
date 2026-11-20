/**
 * Feature flags driven by environment variables.
 *
 * Renderer: values are inlined at Vite build/dev start via `vite.config.ts` define.
 * Main: reads `process.env` at runtime (also inlined when present in `.env.<mode>` via main Vite define).
 */

/** 外观设置「界面主题」区段：默认不展示；`ASTRAVIA_SHOW_UI_THEME=true` 时展示。 */
export const APPEARANCE_UI_THEME_ENV = "ASTRAVIA_SHOW_UI_THEME";

export function isAppearanceUiThemeEnabled(): boolean {
	return process.env.ASTRAVIA_SHOW_UI_THEME === "true";
}

/**
 * 本地语音输入：构建期开关，发布后不能由运行环境重新开启。
 *
 * 只有显式 `false` 才算关闭——与构建脚本 `speech-input-build-config.js` 的
 * `parseConfiguredEnabled`（缺省视为开启）以及 `.env.example` 的说明保持同一口径。
 * 此前这里要求严格等于 `"true"`：发布构建会把计算结果内联进来所以看不出问题，但开发态
 * 没有任何内联，按钮会整块消失，排查「点了没反应」时根本看不到入口。
 */
export function isSpeechInputBuildEnabled(): boolean {
	return process.env.ASTRAVIA_SPEECH_INPUT_ENABLED !== "false";
}

/** Astravia 云服务（登录 / 订阅 / 远程模型等增值能力）：构建期开关。 */
export const CLOUD_ENABLED_ENV = "ASTRAVIA_CLOUD_ENABLED";

/**
 * 云服务是否编入本构建。**默认关闭**（lite / serv-less，开源构建的默认形态）；
 * 只有显式 `ASTRAVIA_CLOUD_ENABLED=true` 才产出接入 Astravia Serv 的完全体。
 * cloud 分支经构建期常量折叠后不进产物，发布后不能由运行环境重新开启。
 */
export function isCloudBuildEnabled(): boolean {
	return process.env.ASTRAVIA_CLOUD_ENABLED === "true";
}
