import { describe, expect, it } from "vitest";

import { resolveDownloadOs, resolveDownloadTarget } from "../src/download-target";

const VERSION = "0.5.60";
const BASE = `https://dl.astravia.dev/app/v${VERSION}`;

/** Apple Silicon 上的 Chrome / Safari 同样上报 "Intel Mac OS X"，这是 issue #5 的根因。 */
const MAC_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const MAC_SAFARI_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const WINDOWS_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const LINUX_UA =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

describe("resolveDownloadOs", () => {
	it("区分 macOS、Windows 与 Linux", () => {
		expect(resolveDownloadOs(MAC_UA)).toBe("macos");
		expect(resolveDownloadOs(WINDOWS_UA)).toBe("windows");
		expect(resolveDownloadOs(LINUX_UA)).toBe("linux");
	});
});

describe("resolveDownloadTarget", () => {
	it("只有 UA 时不会把 Mac 判成 Intel", () => {
		// 回归用例：旧实现用 /ARM|arm64|aarch64/ 匹配 UA，Apple 芯片因此拿到 x64 安装包。
		expect(resolveDownloadTarget({ userAgent: MAC_UA }, { version: VERSION }).architecture).not.toBe("x64");
	});

	it("Apple 芯片的 Mac 拿 arm64 安装包", () => {
		const target = resolveDownloadTarget({ userAgent: MAC_UA, architectureHint: "arm" }, { version: VERSION });
		expect(target.architecture).toBe("arm64");
		expect(target.href).toBe(`${BASE}/Astravia-0.5.60-arm64.dmg`);
		expect(target.label).toBe("MAC ARM64 (APPLE SILICON)");
		expect(target.versionLabel).toBe("v0.5.60 · DMG");
	});

	it("Intel Mac 按架构提示拿无后缀的 x64 安装包并标注 Intel", () => {
		const target = resolveDownloadTarget({ userAgent: MAC_UA, architectureHint: "x86" }, { version: VERSION });
		expect(target.architecture).toBe("x64");
		expect(target.href).toBe(`${BASE}/Astravia-0.5.60.dmg`);
		expect(target.label).toBe("MAC X64 (INTEL)");
	});

	it("拿不到架构提示时（Safari）默认 arm64，并在版本标签里指路 Intel 版", () => {
		const target = resolveDownloadTarget({ userAgent: MAC_SAFARI_UA }, { version: VERSION });
		expect(target.architecture).toBe("unknown");
		expect(target.href).toBe(`${BASE}/Astravia-0.5.60-arm64.dmg`);
		expect(target.versionLabel).toContain("Intel");
	});

	it("Windows 与 Linux 走各自的无架构歧义安装包", () => {
		const windows = resolveDownloadTarget({ userAgent: WINDOWS_UA }, { version: VERSION });
		expect(windows.href).toBe(`${BASE}/Astravia-0.5.60-win-x64.exe`);
		expect(windows.label).toBe("WINDOWS X64");
		expect(windows.versionLabel).not.toContain("Intel");

		const linux = resolveDownloadTarget({ userAgent: LINUX_UA }, { version: VERSION });
		expect(linux.href).toBe(`${BASE}/Astravia-0.5.60.AppImage`);
		expect(linux.label).toBe("LINUX X64");
	});

	it("沿用调用方给定的产物根地址", () => {
		const target = resolveDownloadTarget(
			{ userAgent: MAC_UA, architectureHint: "arm" },
			{ version: VERSION, base: "https://example.test/app" },
		);
		expect(target.href).toBe(`https://example.test/app/Astravia-0.5.60-arm64.dmg`);
	});
});
