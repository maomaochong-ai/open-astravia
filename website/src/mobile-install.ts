/**
 * 官网的手机端安装入口（纯函数 + 一个挂载函数，便于直接单元测试）。
 *
 * 两条路径的性质完全不同，页面上必须说清楚，否则用户下完发现装不上：
 * - Android：每次发版由 CI 用固定密钥签名的 APK 先传到 GitHub Release，再由
 *   `client-mobile-release` 流水线的 `publish-r2` 挑出 ipa / apk 传到 R2 的 client-mobile/。
 *   官网只认这个固定文件名，所以发新版本不需要改页面。
 * - iOS：还没上架 App Store，也没有付费开发者账号时无法生成 Ad Hoc 描述文件。
 *   可用的做法是发一个未签名 IPA，用户用 Sideloadly / AltStore 之类工具以自己的
 *   Apple ID 签名安装。免费账号签出来的 App 每 7 天到期，必须重签。
 *    文件名同样不带版本号：iOS 应用版本与桌面版本本来就是两条线，嵌进链接就是第二个
 *    需要人工同步的事实源。
 */

export type MobilePlatform = "ios" | "android" | "desktop";

export interface MobileInstallOptions {
	/** iOS 产物目录，默认指向 R2 的 client-mobile/。 */
	readonly iosBase?: string;
	/** Android APK 直链，默认指向同一个 R2 目录。 */
	readonly androidUrl?: string;
}

export interface MobileInstallTarget {
	readonly platform: MobilePlatform;
	readonly href: string;
	readonly label: string;
	/** 按钮下方的一行说明，写明体积外的关键限制。 */
	readonly meta: string;
}

const DEFAULT_IOS_BASE = "https://dl.astravia.dev/client-mobile";
const DEFAULT_ANDROID_URL = "https://dl.astravia.dev/client-mobile/Astravia-arm64-v8a.apk";

export function resolveMobilePlatform(userAgent: string): MobilePlatform {
	// iPad 的 UA 在 iPadOS 13 之后伪装成 Macintosh，只有手机端 UA 能可靠区分。
	if (/iPhone|iPod/i.test(userAgent)) return "ios";
	if (/iPad/i.test(userAgent)) return "ios";
	if (/Android/i.test(userAgent)) return "android";
	return "desktop";
}

export function resolveMobileInstall(
	platform: MobilePlatform,
	{ iosBase = DEFAULT_IOS_BASE, androidUrl = DEFAULT_ANDROID_URL }: MobileInstallOptions = {},
): MobileInstallTarget {
	if (platform === "ios") {
		return {
			platform,
			href: `${iosBase}/Astravia-ios.ipa`,
			label: "下载 IPA",
			meta: "IPA · 需自备 Apple ID 签名",
		};
	}
	if (platform === "android") {
		return {
			platform,
			href: androidUrl,
			label: "下载 APK",
			meta: "arm64-v8a · 直接安装",
		};
	}
	return {
		platform,
		href: androidUrl,
		label: "下载 APK",
		meta: "在手机上打开本页可自动识别",
	};
}

/**
 * 把链接与「你当前用的是哪一端」写进页面。
 * 桌面访问时两块都给出来，不替用户选——他可能只是想发链接给别人。
 */
export function initMobileInstall(options: MobileInstallOptions = {}): void {
	const platform = resolveMobilePlatform(navigator.userAgent);

	// 桌面访问时 Android 那块改成提示语：他看的是电脑屏幕，点下去只会在电脑上落一个 APK。
	const androidTarget = resolveMobileInstall(platform === "desktop" ? "desktop" : "android", options);

	const apply = (key: "ios" | "android") => {
		const target = key === "ios" ? resolveMobileInstall("ios", options) : androidTarget;
		const link = document.getElementById(key === "ios" ? "mobIosHref" : "mobAndroidHref");
		const meta = document.getElementById(key === "ios" ? "mobIosMeta" : "mobAndroidMeta");
		if (link instanceof HTMLAnchorElement) link.href = target.href;
		if (meta) meta.textContent = target.meta;
		const card = document.querySelector<HTMLElement>(`[data-mob="${key}"]`);
		card?.classList.toggle("is-detected", platform === key);
	};

	apply("ios");
	apply("android");
}
