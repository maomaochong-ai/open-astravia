// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initDownloadLinks, initDownloadPlatformHighlight } from "../src/download-links";

const VERSION = "0.5.61";
const BASE = `https://dl.astravia.dev/app/v${VERSION}`;

/** Apple Silicon 上的 Chrome / Safari 同样上报 "Intel Mac OS X"。 */
const MAC_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const WINDOWS_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

// 测试始终从 website 包目录运行：bun run test 与 scripts/quality/* 都是这样调用。
const pageHtml = readFileSync(resolve("index.html"), "utf8");

function mountPage() {
	const parsed = new DOMParser().parseFromString(pageHtml, "text/html");
	document.body.innerHTML = parsed.body.innerHTML;
}

function setDevice({ userAgent, architecture }: { userAgent: string; architecture?: string }) {
	Object.defineProperty(window.navigator, "userAgent", { value: userAgent, configurable: true });
	Object.defineProperty(window.navigator, "userAgentData", {
		value: architecture ? { getHighEntropyValues: async () => ({ architecture }) } : undefined,
		configurable: true,
	});
}

function downloadEntry() {
	return {
		primary: document.getElementById("dlPrimary") as HTMLAnchorElement,
		primaryText: document.getElementById("dlPrimaryText"),
		primaryVersion: document.getElementById("dlPrimaryVersion"),
		nav: document.querySelector<HTMLAnchorElement>(".nav__download"),
		hero: document.querySelector<HTMLAnchorElement>(".hero .btn--primary.btn--lg"),
	};
}

beforeEach(() => {
	mountPage();
});

describe("官网下载入口", () => {
	it("Apple 芯片 Mac 先按 arm64 落地，导航与 Hero 同步", async () => {
		setDevice({ userAgent: MAC_UA, architecture: "arm" });
		const entry = downloadEntry();
		initDownloadLinks();

		expect(entry.primary.href).toBe(`${BASE}/Astravia-${VERSION}-arm64.dmg`);
		// 架构探测期间也不能给 Apple 芯片用户闪一条 Intel 提示。
		expect(entry.primaryVersion?.textContent).toBe(`v${VERSION} · DMG`);
		await vi.waitFor(() => expect(entry.primaryText?.textContent).toBe("MAC ARM64 (APPLE SILICON)"));
		expect(entry.primaryVersion?.textContent).toBe(`v${VERSION} · DMG`);
		expect(entry.nav?.href).toBe(entry.primary.href);
		expect(entry.hero?.href).toBe(entry.primary.href);
	});

	it("Intel Mac 在拿到架构提示后换成 Intel 安装包", async () => {
		setDevice({ userAgent: MAC_UA, architecture: "x86" });
		const entry = downloadEntry();
		initDownloadLinks();

		await vi.waitFor(() => expect(entry.primary.href).toBe(`${BASE}/Astravia-${VERSION}.dmg`));
		expect(entry.primaryText?.textContent).toBe("MAC X64 (INTEL)");
		expect(entry.nav?.href).toBe(entry.primary.href);
		expect(entry.hero?.href).toBe(entry.primary.href);
	});

	it("Safari 拿不到架构提示时默认 arm64，并提示 Intel 用户改选", () => {
		setDevice({ userAgent: MAC_UA });
		const entry = downloadEntry();
		initDownloadLinks();

		expect(entry.primary.href).toBe(`${BASE}/Astravia-${VERSION}-arm64.dmg`);
		expect(entry.primaryVersion?.textContent).toContain("Intel");
	});

	it("Windows 用户拿 exe，且不出现 Intel 提示", () => {
		setDevice({ userAgent: WINDOWS_UA });
		const entry = downloadEntry();
		initDownloadLinks();

		expect(entry.primary.href).toBe(`${BASE}/Astravia-${VERSION}-win-x64.exe`);
		expect(entry.primaryText?.textContent).toBe("WINDOWS X64");
		expect(entry.primaryVersion?.textContent).toBe(`v${VERSION} · EXE`);
	});

	it("平台图标按当前系统高亮", () => {
		setDevice({ userAgent: MAC_UA });
		initDownloadPlatformHighlight();

		const macIcon = document.querySelector<HTMLElement>('.dl-platform-icon[data-p="ollama"]');
		const winIcon = document.querySelector<HTMLElement>('.dl-platform-icon[data-p="kimi"]');
		expect(macIcon?.style.opacity).toBe("0.6");
		expect(winIcon?.style.opacity).not.toBe("0.6");
	});
});
