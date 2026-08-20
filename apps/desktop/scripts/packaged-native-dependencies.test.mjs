import assert from "node:assert/strict";
import test from "node:test";
import { resolveMainBundleExternals, resolvePackagedNativeDependencies } from "./packaged-native-dependencies.mjs";

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

test("omits sherpa from a speech-disabled Windows artifact", () => {
	const windows = resolvePackagedNativeDependencies(new Set(["win32"]), { speechInputEnabled: false });
	assert.ok(!windows.required.includes("sherpa-onnx-win-x64"));
	assert.ok(!windows.asarUnpack.some((pattern) => pattern.includes("sherpa")));
});

test("keeps darwin-only glass out of Windows and Linux artifacts", () => {
	for (const platform of ["win32", "linux"]) {
		const result = resolvePackagedNativeDependencies(new Set([platform]));
		assert.deepEqual(result.optional, []);
	}
	const mac = resolvePackagedNativeDependencies(new Set(["darwin"]));
	assert.deepEqual(mac.optional, ["electron-liquid-glass"]);
});

test("stages every dependency the main bundle marks external", () => {
	// staging 漏掉任何一个 external 都是「打包后应用起不来」级别的故障（ws 曾如此），
	// 所以两个消费者必须来自同一份定义。
	const externals = resolveMainBundleExternals();
	const staged = new Set(
		["darwin", "win32", "linux"].flatMap((platform) => {
			const result = resolvePackagedNativeDependencies(new Set([platform]));
			return [...result.required, ...result.optional];
		}),
	);
	for (const dep of externals) {
		assert.ok(staged.has(dep), `${dep} 被标成 external 却没有任何平台会 stage 它`);
	}
});

test("keeps ws in every artifact and koffi only on Windows", () => {
	for (const platform of ["darwin", "win32", "linux"]) {
		const result = resolvePackagedNativeDependencies(new Set([platform]));
		assert.ok(result.required.includes("ws"), `${platform} 产物缺少 ws`);
	}
	assert.ok(resolvePackagedNativeDependencies(new Set(["win32"])).required.includes("koffi"));
	assert.ok(resolvePackagedNativeDependencies(new Set(["win32"])).asarUnpack.includes("node_modules/koffi/**/*"));
	for (const platform of ["darwin", "linux"]) {
		assert.ok(!resolvePackagedNativeDependencies(new Set([platform])).required.includes("koffi"));
	}
});

test("keeps platform-specific packages external regardless of build target", () => {
	// bundle 只构建一份：按平台过滤 external 会把原生模块打进 bundle 直接构建失败。
	const externals = resolveMainBundleExternals();
	assert.ok(externals.includes("koffi"));
	assert.ok(externals.includes("electron-liquid-glass"));
	assert.ok(externals.includes("sherpa-onnx-win-x64"));
	assert.ok(!resolveMainBundleExternals({ speechInputEnabled: false }).includes("sherpa-onnx-win-x64"));
});
