import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
	DESKTOP_BUILD_OUTPUTS,
	DESKTOP_REQUIRED_SOURCE_FILES,
	ASTRAVIA_PLUGIN_FILE_ASSOCIATION,
} from "./desktop-packaging-layout.mjs";

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

test("packaged Desktop registers the dedicated Astravia plugin package type", () => {
	assert.deepEqual(ASTRAVIA_PLUGIN_FILE_ASSOCIATION, {
		ext: "astraviapkg",
		name: "Astravia Plugin Package",
		description: "Installable Astravia plugin package",
		mimeType: "application/vnd.astravia.plugin+zip",
		role: "Editor",
	});
});
