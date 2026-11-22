import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WINDOWS_SANDBOX_BINARY_NAMES } from "./windows-sandbox-packaging.mjs";
import { readSandboxReleasePins, stageNativeBinaries } from "./stage-dev-native-binaries.mjs";

/**
 * 沙盒发布包的版本坐标只有一份：CI 的 composite action。
 * 这里断言脚本确实从那里读，而不是自己再抄一遍 tag / commit / SHA。
 */
test("sandbox release pins come from the CI action, not a second copy", async () => {
	// 用例可能从 apps/desktop 里跑，所以路径按本文件定位仓库根。
	const repoRoot = join(import.meta.dirname, "..", "..", "..");
	const pins = readSandboxReleasePins(repoRoot);

	assert.equal(pins.repository, "maomaochong-ai/codex");
	assert.match(pins.tag, /^astravia-sandbox-v\d+\.\d+\.\d+$/);
	assert.match(pins.commit, /^[0-9a-f]{40}$/);
	assert.match(pins.archiveSha256, /^[0-9a-f]{64}$/);
	assert.match(pins.archive, /\.zip$/);

	// 与 action.yml 原文一致（脚本读的就是它）。
	const action = await readFile(join(repoRoot, ".github", "actions", "prepare-windows-sandbox", "action.yml"), "utf8");
	assert.ok(action.includes(pins.tag));
	assert.ok(action.includes(pins.archiveSha256));
});

/**
 * 已安装版本里取文件时，清单必须与打包链共用：漏了 command-runner，
 * prepare-pack 的 stageWindowsSandboxBinaries 会在打包阶段直接抛错。
 */
test("staging from an installed version copies every binary the packager requires", async () => {
	const repoRoot = await mkdtemp(join(tmpdir(), "astravia-stage-"));
	const resourcesDir = await mkdtemp(join(tmpdir(), "astravia-resources-"));
	await mkdir(join(resourcesDir, "sandbox", "windows"), { recursive: true });
	await mkdir(join(resourcesDir, "im-gateway"), { recursive: true });
	for (const name of WINDOWS_SANDBOX_BINARY_NAMES) {
		await writeFile(join(resourcesDir, "sandbox", "windows", name), name);
	}
	await writeFile(join(resourcesDir, "im-gateway", "im-gateway-windows-amd64.exe"), "sidecar");

	const { staged, missing } = stageNativeBinaries({ resourcesDir, repoRoot, log: () => {} });

	assert.deepEqual(missing, []);
	assert.equal(staged.length, WINDOWS_SANDBOX_BINARY_NAMES.length + 1);
	for (const name of WINDOWS_SANDBOX_BINARY_NAMES) {
		await access(join(repoRoot, "packages", "runtime-core", "sandbox", "bin", name));
	}
	const sidecar = await readFile(join(repoRoot, "apps", "im-gateway", "dist", "im-gateway-windows-amd64.exe"), "utf8");
	assert.equal(sidecar, "sidecar");
});

test("a missing binary is reported instead of silently skipped", async () => {
	const repoRoot = await mkdtemp(join(tmpdir(), "astravia-stage-missing-"));
	const resourcesDir = await mkdtemp(join(tmpdir(), "astravia-resources-missing-"));
	await mkdir(join(resourcesDir, "sandbox", "windows"), { recursive: true });

	const { missing } = stageNativeBinaries({ resourcesDir, repoRoot, log: () => {} });

	assert.deepEqual(missing, [
		...WINDOWS_SANDBOX_BINARY_NAMES.map((name) => `sandbox/${name}`),
		"im-gateway/",
	]);
});
