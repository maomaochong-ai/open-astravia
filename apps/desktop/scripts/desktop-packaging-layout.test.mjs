import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DESKTOP_BUILD_OUTPUTS, DESKTOP_REQUIRED_SOURCE_FILES } from "./desktop-packaging-layout.mjs";

const desktopRoot = join(import.meta.dirname, "..");

test("production build outputs have stable staging destinations", () => {
	assert.deepEqual(
		DESKTOP_BUILD_OUTPUTS,
		[
			{ source: "dist/main", target: "main" },
			{ source: "dist/preload", target: "preload" },
			{ source: "dist/renderer", target: "renderer" },
			{ source: "dist/ocr-preload", target: "ocr-preload" },
			{ source: "dist/ocr-runner", target: "ocr-runner" },
		],
	);
});

test("required source entry points exist", () => {
	for (const relativePath of DESKTOP_REQUIRED_SOURCE_FILES) {
		assert.ok(existsSync(join(desktopRoot, relativePath)), `missing Desktop source entry: ${relativePath}`);
	}
});
