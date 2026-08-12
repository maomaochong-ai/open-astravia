import assert from "node:assert/strict";
import test from "node:test";
import { resolvePackagedNativeDependencies } from "./packaged-native-dependencies.mjs";

test("stages sherpa only for Windows targets", () => {
	const windows = resolvePackagedNativeDependencies(new Set(["win32"]));
	assert.ok(windows.required.includes("sherpa-onnx-win-x64"));
	assert.ok(windows.asarUnpack.includes("node_modules/sherpa-onnx-win-x64/**/*"));

	for (const platform of ["darwin", "linux"]) {
		const result = resolvePackagedNativeDependencies(new Set([platform]));
		assert.ok(!result.required.includes("sherpa-onnx-win-x64"));
		assert.ok(!result.asarUnpack.some((pattern) => pattern.includes("sherpa")));
	}
});

test("keeps darwin-only glass out of Windows and Linux artifacts", () => {
	for (const platform of ["win32", "linux"]) {
		const result = resolvePackagedNativeDependencies(new Set([platform]));
		assert.deepEqual(result.optional, []);
	}
	const mac = resolvePackagedNativeDependencies(new Set(["darwin"]));
	assert.deepEqual(mac.optional, ["electron-liquid-glass"]);
});
