/**
 * 开发态外部二进制补齐。
 *
 * 有两个能力依赖**仓库里没有**的原生二进制，它们只在打包时由各自的构建链产出：
 *
 * | 能力 | 二进制 | 打包后位置 | 开发态读取位置 |
 * | --- | --- | --- | --- |
 * | 沙箱（Windows） | `codex-windows-sandbox-host.exe` | `resources/sandbox/windows/` | `packages/runtime-core/sandbox/bin/` |
 * | IM 通道（微信 / WhatsApp…） | `im-gateway-<os>-<arch>[.exe]` | `resources/im-gateway/` | `apps/im-gateway/dist/` |
 *
 * 缺少它们的表现是：设置里的「使用沙盒」永久置灰（`binary_not_found`），
 * 微信扫码报「sidecar 未运行」。两者都不是代码缺陷，而是本机还没准备这些产物。
 *
 * 本脚本从**已安装的 Astravia** 里取出这两组文件放到开发态读取位置，
 * 让开发态与打包态行为一致；也可以显式指定一个已安装版本目录。
 *
 * 用法：
 *   node apps/desktop/scripts/stage-dev-native-binaries.mjs [--from <已安装版本目录>] [--dry-run]
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const WINDOWS_SANDBOX_BINARIES = ["codex-windows-sandbox-host.exe", "codex-windows-sandbox-setup.exe"];
const SIDECAR_PREFIX = "im-gateway-";

/** 从 `%LOCALAPPDATA%\Astravia\versions\<最高版本>` 里挑一个带 resources 的目录。 */
function findInstalledVersionDirs(env = process.env) {
	const base = env.ASTRAVIA_INSTALL_ROOT ??
		join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Astravia", "versions");
	if (!existsSync(base)) return [];
	return readdirSync(base)
		.map((name) => ({ name, path: join(base, name) }))
		.filter((entry) => existsSync(join(entry.path, "resources")))
		.sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }))
		.map((entry) => join(entry.path, "resources"));
}

function parseArgs(argv) {
	const args = { from: undefined, dryRun: false };
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === "--dry-run") args.dryRun = true;
		else if (value === "--from") args.from = argv[++index];
	}
	return args;
}

export function stageNativeBinaries({ resourcesDir, repoRoot, dryRun = false, log = console.log }) {
	const staged = [];
	const missing = [];

	const sandboxSource = join(resourcesDir, "sandbox", "windows");
	const sandboxTarget = join(repoRoot, "packages", "runtime-core", "sandbox", "bin");
	for (const name of WINDOWS_SANDBOX_BINARIES) {
		const source = join(sandboxSource, name);
		if (!existsSync(source)) {
			missing.push(`sandbox/${name}`);
			continue;
		}
		const target = join(sandboxTarget, name);
		if (!dryRun) {
			mkdirSync(dirname(target), { recursive: true });
			copyFileSync(source, target);
		}
		staged.push(target);
		log(`[stage-native] ${name} → ${target}`);
	}

	const sidecarSource = join(resourcesDir, "im-gateway");
	const sidecarTarget = join(repoRoot, "apps", "im-gateway", "dist");
	for (const name of existsSync(sidecarSource) ? readdirSync(sidecarSource) : []) {
		if (!name.startsWith(SIDECAR_PREFIX) || !name.endsWith(".exe")) continue;
		const target = join(sidecarTarget, name);
		if (!dryRun) {
			mkdirSync(dirname(target), { recursive: true });
			copyFileSync(join(sidecarSource, name), target);
		}
		staged.push(target);
		log(`[stage-native] ${name} → ${target}`);
	}
	if (!existsSync(sidecarSource)) missing.push("im-gateway/");

	return { missing, staged };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"))) {
	const { from, dryRun } = parseArgs(process.argv.slice(2));
	const repoRoot = join(import.meta.dirname, "..", "..", "..");
	const candidates = from ? [from] : findInstalledVersionDirs();
	if (candidates.length === 0) {
		console.error(
			"[stage-native] 找不到已安装的 Astravia 版本目录。用 --from 指定一个 resources 目录，或先安装一次应用。",
		);
		process.exit(1);
	}

	// 逐个候选尝试：某个版本可能只带其中一个二进制。
	const collected = new Set();
	for (const resourcesDir of candidates) {
		const { staged, missing } = stageNativeBinaries({ resourcesDir, repoRoot, dryRun });
		for (const path of staged) collected.add(path);
		if (!missing.includes("im-gateway/") && !missing.some((name) => name.startsWith("sandbox/"))) break;
	}

	const sizeMb = (path) => `${(statSync(path).size / 1024 / 1024).toFixed(1)} MB`;
	console.log(`[stage-native] 完成：${collected.size} 个文件${dryRun ? "（dry-run，未写入）" : ""}`);
	for (const path of collected) console.log(`  ${path}  ${dryRun ? "" : sizeMb(path)}`);
}
