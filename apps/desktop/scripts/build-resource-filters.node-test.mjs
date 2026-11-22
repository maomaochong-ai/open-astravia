import assert from "node:assert/strict";
import test from "node:test";
import { resolveBuildResourceFilters } from "./build-resource-filters.mjs";

// app-icon-icos/** 必须在三个平台都存在：Windows 用 .ico 改写快捷方式，
// macOS / Linux 也读同一份 resources/build，缺了会在换图标时抛 ENOENT。
test("Windows packages include both the app icon and native drag icon", () => {
	assert.deepEqual(resolveBuildResourceFilters(new Set(["win32"])), [
		"pet/**/*",
		"app-icons/**/*",
		"app-icon-icos/**/*",
		"icon.ico",
		"icon.png",
	]);
});

test("platform-specific icon filters remain isolated", () => {
	assert.deepEqual(resolveBuildResourceFilters(new Set(["linux"])), [
		"pet/**/*",
		"app-icons/**/*",
		"app-icon-icos/**/*",
		"icon.png",
	]);
	assert.deepEqual(resolveBuildResourceFilters(new Set(["darwin"])), [
		"pet/**/*",
		"app-icons/**/*",
		"app-icon-icos/**/*",
		"icon.icns",
		"icon.png",
		"icon-dock.png",
	]);
});
