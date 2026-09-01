import { describe, expect, it } from "vitest";
import { detectPlatform, looksLikeXcodeProject, shouldShowTab } from "../src/tab-visibility.js";

describe("looksLikeXcodeProject", () => {
	it("recognises Xcode and SwiftPM workspaces", () => {
		expect(looksLikeXcodeProject(["MyApp.xcodeproj", "README.md"])).toBe(true);
		expect(looksLikeXcodeProject(["MyApp.xcworkspace"])).toBe(true);
		expect(looksLikeXcodeProject(["Package.swift"])).toBe(true);
	});

	it("does not match unrelated directories", () => {
		expect(looksLikeXcodeProject(["package.json", "src"])).toBe(false);
		expect(looksLikeXcodeProject([])).toBe(false);
	});

	it("does not match a name that merely contains the marker", () => {
		expect(looksLikeXcodeProject(["notes-about-Package.swift.md"])).toBe(false);
	});
});

describe("shouldShowTab", () => {
	it("shows only on macOS with an iOS project", () => {
		expect(shouldShowTab({ platform: "darwin", entryNames: ["A.xcodeproj"] })).toBe(true);
	});

	it("stays hidden off macOS even in an iOS project", () => {
		// 非 macOS 上 baguette 和 Xcode 都不存在，上栏只会给出一个永远报错的面板。
		expect(shouldShowTab({ platform: "win32", entryNames: ["A.xcodeproj"] })).toBe(false);
	});

	it("stays hidden on macOS outside an iOS project", () => {
		expect(shouldShowTab({ platform: "darwin", entryNames: ["package.json"] })).toBe(false);
	});

	it("shows anywhere on macOS once the user opts in", () => {
		// 工程不在仓库顶层时（monorepo、子目录）用户可以在配置页强制显示。
		expect(shouldShowTab({ platform: "darwin", entryNames: ["package.json"], alwaysShow: true })).toBe(true);
	});

	it("still refuses to show off macOS even with the opt-in", () => {
		expect(shouldShowTab({ platform: "win32", entryNames: ["A.xcodeproj"], alwaysShow: true })).toBe(false);
	});
});

describe("detectPlatform", () => {
	it("maps Electron's macOS user agent to darwin", () => {
		expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")).toBe("darwin");
	});

	it("maps everything else away from darwin", () => {
		expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("other");
		expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("other");
	});
});
