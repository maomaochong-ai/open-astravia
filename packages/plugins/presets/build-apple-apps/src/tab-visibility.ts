/**
 * 活动 Tab 的出现条件。纯函数，便于覆盖各种目录形态。
 *
 * fail-closed：非 macOS 一律不上栏——那里 Xcode 和 baguette 都不存在，
 * 上栏只会给出一个永远报错的面板。macOS 上默认只在看起来是 iOS/Swift 工程的
 * 目录里出现，用户可以在工作区配置里改成始终显示。
 */

export const TAB_ID = "simulator";

/** 判定为 Xcode / SwiftPM 工程的顶层标志。 */
const PROJECT_MARKERS = [".xcodeproj", ".xcworkspace"] as const;
const PROJECT_FILES = ["Package.swift"] as const;

export function looksLikeXcodeProject(entryNames: readonly string[]): boolean {
	return entryNames.some(
		(name) =>
			PROJECT_MARKERS.some((suffix) => name.endsWith(suffix)) || PROJECT_FILES.some((file) => name === file),
	);
}

export function shouldShowTab(options: {
	readonly platform: string;
	readonly entryNames: readonly string[];
	readonly alwaysShow?: boolean;
}): boolean {
	if (options.platform !== "darwin") return false;
	return options.alwaysShow === true || looksLikeXcodeProject(options.entryNames);
}

/**
 * 从 renderer 的 userAgent 推断宿主平台。SDK 没有暴露平台信息，而 Electron
 * 的 UA 在 Apple Silicon 上同样是 "Macintosh"，用它判 macOS 是稳的。
 */
export function detectPlatform(userAgent: string): string {
	return /Macintosh|Mac OS X/.test(userAgent) ? "darwin" : "other";
}
