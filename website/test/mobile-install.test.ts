// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { initMobileInstall, resolveMobileInstall, resolveMobilePlatform } from "../src/mobile-install";

const IPHONE_UA =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const IPAD_UA =
	"Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
	"Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const MAC_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

// 与 download-entry.test.ts 一致：测试从 website 包目录运行，直接读真实页面。
const pageHtml = readFileSync(resolve("index.html"), "utf8");

function mountPage() {
	const parsed = new DOMParser().parseFromString(pageHtml, "text/html");
	document.body.innerHTML = parsed.body.innerHTML;
}

function setUserAgent(userAgent: string) {
	Object.defineProperty(window.navigator, "userAgent", { value: userAgent, configurable: true });
}

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
	it("iOS 指向固定的 IPA 文件名，并在说明里写清需要自己签名", () => {
		const target = resolveMobileInstall("ios");
		expect(target.href).toBe("https://dl.astravia.dev/client-mobile/Astravia-ios.ipa");
		expect(target.meta).toContain("签名");
	});
	it("Android 与 iOS 共用一个 R2 目录，文件名不带版本号", () => {
		const target = resolveMobileInstall("android");
		expect(target.href).toBe("https://dl.astravia.dev/client-mobile/Astravia-arm64-v8a.apk");
	});
});

describe("页面上真的存在这两个入口", () => {
	beforeEach(() => {
		mountPage();
	});

	it("iPhone 上打开页面时，iOS 按钮指向 IPA，Android 按钮同样可用", () => {
		setUserAgent(IPHONE_UA);
		initMobileInstall();

		const ios = document.getElementById("mobIosHref") as HTMLAnchorElement;
		const android = document.getElementById("mobAndroidHref") as HTMLAnchorElement;
		expect(ios.getAttribute("href")).toBe("https://dl.astravia.dev/client-mobile/Astravia-ios.ipa");
		expect(android.getAttribute("href")).toContain("Astravia-arm64-v8a.apk");
		expect(document.querySelector('[data-mob="ios"]')?.classList.contains("is-detected")).toBe(true);
		expect(document.querySelector('[data-mob="android"]')?.classList.contains("is-detected")).toBe(false);
	});

	it("Android 手机上打开页面时，高亮切到 Android 那块", () => {
		setUserAgent(ANDROID_UA);
		initMobileInstall();

		expect(document.querySelector('[data-mob="android"]')?.classList.contains("is-detected")).toBe(true);
		expect(document.querySelector('[data-mob="ios"]')?.classList.contains("is-detected")).toBe(false);
	});

	it("桌面访问时两块都给出来，不预选任何一端", () => {
		setUserAgent(MAC_UA);
		initMobileInstall();

		expect(document.querySelector(".mob-card.is-detected")).toBeNull();
		const meta = document.getElementById("mobAndroidMeta");
		expect(meta?.textContent).toContain("手机上打开本页");
	});

	it("安装说明写清了 7 天重签这个真实的限制", () => {
		const steps = document.querySelector('[data-mob="ios"] .mob-card__steps')?.textContent ?? "";
		expect(steps).toContain("7 天");
		expect(steps).toContain("扫码");
	});

	// 页面上的静态 href 是给禁用 JS / 预渲染爬取看的那一份。它必须与 JS 算出的地址一致，
	// 否则两条路径会分别指向不同产物。
	it("静态 href 与 JS 解析结果一致，禁用 JS 也能下到同一个文件", () => {
		setUserAgent(MAC_UA);
		initMobileInstall();
		const staticIos = new DOMParser()
			.parseFromString(pageHtml, "text/html")
			.getElementById("mobIosHref")
			?.getAttribute("href");
		const staticAndroid = new DOMParser()
			.parseFromString(pageHtml, "text/html")
			.getElementById("mobAndroidHref")
			?.getAttribute("href");
		expect(document.getElementById("mobIosHref")?.getAttribute("href")).toBe(staticIos);
		expect(document.getElementById("mobAndroidHref")?.getAttribute("href")).toBe(staticAndroid);
	});
});
