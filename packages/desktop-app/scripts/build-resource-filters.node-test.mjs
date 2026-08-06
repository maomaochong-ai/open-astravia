import assert from "node:assert/strict";
import test from "node:test";
import { resolveBuildResourceFilters } from "./build-resource-filters.mjs";

test("Windows packages include both the app icon and native drag icon", () => {
	assert.deepEqual(resolveBuildResourceFilters(new Set(["win32"])), ["pet/**/*", "icon.ico", "icon.png"]);
});

test("platform-specific icon filters remain isolated", () => {
	assert.deepEqual(resolveBuildResourceFilters(new Set(["linux"])), ["pet/**/*", "icon.png"]);
	assert.deepEqual(resolveBuildResourceFilters(new Set(["darwin"])), [
		"pet/**/*",
		"icon.icns",
		"icon.png",
		"icon-dock.png",
	]);
});
