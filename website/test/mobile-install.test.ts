// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { renderPage } from "./render";
import { resolveMobileInstall, resolveMobilePlatform } from "../src/lib/mobile-install";

const IPHONE_UA =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const IPAD_UA =
	"Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
	"Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const MAC_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

describe("resolveMobilePlatform", () => {
	it("认得出 iPhone / iPad / Android，桌面浏览器归为 desktop", () => {
		expect(resolveMobilePlatform(IPHONE_UA)).toBe("ios");
		expect(resolveMobilePlatform(IPAD_UA)).toBe("ios");
		expect(resolveMobilePlatform(ANDROID_UA)).toBe("android");
		expect(resolveMobilePlatform(MAC_UA)).toBe("desktop");
	});

	it("Android 平板的 UA 里带 Linux，不能因此被当成桌面", () => {
		expect(resolveMobilePlatform(ANDROID_UA)).toBe("android");
	});
});

describe("resolveMobileInstall", () => {
	it("iOS 给 IPA 并说明要自己签名", () => {
		const target = resolveMobileInstall("ios");
		expect(target.href).toBe("https://dl.astravia.dev/client-mobile/Astravia-ios.ipa");
		expect(target.label).toBe("下载 IPA");
		expect(target.meta).toContain("Apple ID");
	});

	it("Android 给固定文件名的 APK", () => {
		const target = resolveMobileInstall("android");
		expect(target.href).toBe("https://dl.astravia.dev/client-mobile/Astravia-arm64-v8a.apk");
		expect(target.label).toBe("下载 APK");
	});

	it("桌面访问时说明要在手机上打开本页", () => {
		expect(resolveMobileInstall("desktop").meta).toContain("手机");
	});
});

describe("下载页的手机端区块", () => {
	const markup = renderPage("download");
	const block = markup.slice(markup.indexOf('id="dlMobile"'), markup.indexOf("</section>", markup.indexOf('id="dlMobile"')));

	it("两块卡片并排在同一屏，不再各占一整行", () => {
		expect([...block.matchAll(/class="mob-card reveal"/g)]).toHaveLength(2);
		expect(block).toContain('data-mob="ios"');
		expect(block).toContain('data-mob="android"');
	});

	it("文案写清签名限制与配对方式", () => {
		expect(block).toContain("Apple ID");
		expect(block).toContain("手机扫码连接");
		expect(block).toContain("7 天");
	});

	it("两个入口都指向 client-mobile 下的固定产物", () => {
		expect(block).toContain("https://dl.astravia.dev/client-mobile/Astravia-ios.ipa");
		expect(block).toContain("https://dl.astravia.dev/client-mobile/Astravia-arm64-v8a.apk");
	});
});
