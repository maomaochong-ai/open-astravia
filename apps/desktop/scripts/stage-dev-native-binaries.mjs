/**
 * 开发态外部二进制补齐。
 *
 * 两个能力依赖**仓库里没有**的原生二进制，只在打包链里产出：
 *
 * | 能力 | 二进制 | 打包后位置 | 开发态读取位置 |
 * | --- | --- | --- | --- |
 * | 沙箱（Windows） | `codex-windows-sandbox-host.exe` 等三个 | `resources/sandbox/windows/` | `packages/runtime-core/sandbox/bin/` |
 * | IM 通道（微信 / WhatsApp…） | `im-gateway-<os>-<arch>[.exe]` | `resources/im-gateway/` | `apps/im-gateway/dist/` |
 *
 * 缺少它们的表现：设置里的「使用沙盒」永久置灰（`binary_not_found`），微信扫码报
 * 「sidecar 未运行」。两者都不是代码缺陷，而是本机还没准备这些产物。
 *
 * 三种来源（按用途选）：
 * - `--sandbox-release`：下载 CI 用的那个固定版本沙盒发布包（推荐；tag / commit / SHA-256
 *   直接从 `.github/actions/prepare-windows-sandbox/action.yml` 读，避免第二份真相）；
 * - `--from <resources 目录>`：从一个已安装版本里取；
 * - 默认：在 `%LOCALAPPDATA%\Astravia\versions` 里找最高版本。
 *
 * 注意：`cargo build -p codex-windows-sandbox --bins` 在当前 codex 上**不再产出**
 * `codex-windows-sandbox-host.exe`（只剩 setup / command-runner / managed-deny-probe）。
 * 沙盒宿主是这个仓库的上游发布包里的产物，所以这里走下载而不是本地编译。
 *
 * 用法：
 *   node apps/desktop/scripts/stage-dev-native-binaries.mjs --sandbox-release
 *   node apps/desktop/scripts/stage-dev-native-binaries.mjs [--from <resources>] [--dry-run]
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { WINDOWS_SANDBOX_BINARY_NAMES } from "./windows-sandbox-packaging.mjs";

const SIDECAR_PREFIX = "im-gateway-";
const ACTION_FILE = join(".github", "actions", "prepare-windows-sandbox", "action.yml");

function repoRootFromHere() {
	return join(import.meta.dirname, "..", "..", "..");
}

/**
 * 从 CI 的 composite action 里读出固定版本的坐标。
 *
 * 沙盒发布包是「tag + 源码提交 + 压缩包 SHA-256」三者一起钉死的；在脚本里再抄一遍
 * 必然会漂。CI 里那份 action.yml 才是唯一真相，所以这里直接解析它的 env 块。
 */
export function readSandboxReleasePins(repoRoot = repoRootFromHere()) {
	const actionPath = join(repoRoot, ACTION_FILE);
	if (!existsSync(actionPath)) throw new Error(`找不到沙盒准备 action：${actionPath}`);
	const text = readFileSync(actionPath, "utf8");
	const read = (key) => text.match(new RegExp(`^\\s*${key}:\\s*(\\S+)\\s*$`, "m"))?.[1];
	const pins = {
		repository: read("SANDBOX_REPOSITORY"),
		tag: read("SANDBOX_TAG"),
		commit: read("SANDBOX_COMMIT"),
		archive: read("SANDBOX_ARCHIVE"),
		archiveSha256: read("SANDBOX_ARCHIVE_SHA256"),
	};
	const missing = Object.entries(pins).filter(([, value]) => !value).map(([key]) => key);
	if (missing.length > 0) throw new Error(`${ACTION_FILE} 缺少这些固定值：${missing.join(", ")}`);
	return pins;
}

function sha256File(path) {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		createReadStream(path)
			.on("data", (chunk) => hash.update(chunk))
			.on("error", reject)
			.on("end", () => resolve(hash.digest("hex")));
	});
}

/**
 * 下载。先走 curl（自带重试）：GitHub 的 objects CDN 在部分网络里会中途 ECONNRESET，
 * Node 的 fetch 没有重试，一断就整次失败。curl 不可用时才退回 fetch。
 */
async function download(url, destination) {
	mkdirSync(dirname(destination), { recursive: true });
	try {
		execFileSync("curl", ["-L", "--retry", "5", "--retry-delay", "2", "--max-time", "600", "-o", destination, url], {
			stdio: "ignore",
		});
		return statSync(destination).size;
	} catch {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`下载失败 ${response.status}：${url}`);
		const buffer = Buffer.from(await response.arrayBuffer());
		await Bun.write(destination, buffer);
		return buffer.length;
	}
}

/**
 * 下载固定版本的沙盒发布包，校验压缩包 → 校验每个二进制 → 校验源码提交，最后落位。
 * 任何一步对不上都直接失败：沙盒报「可用」但实际不受约束，比不可用更危险。
 */
export async function stageSandboxFromRelease({ repoRoot, dryRun = false, log = console.log }) {
	const pins = readSandboxReleasePins(repoRoot);
	const url = `https://github.com/${pins.repository}/releases/download/${pins.tag}/${pins.archive}`;
	const workDir = join(tmpdir(), "astravia-sandbox-release");
	const archivePath = join(workDir, pins.archive);
	const extractDir = join(workDir, "extracted");

	log(`[stage-native] 下载 ${pins.tag}（${pins.commit.slice(0, 8)}）`);
	await download(url, archivePath);
	const archiveSha = await sha256File(archivePath);
	if (archiveSha !== pins.archiveSha256) {
		throw new Error(`沙盒压缩包 SHA-256 不匹配：期望 ${pins.archiveSha256}，实际 ${archiveSha}`);
	}

	execFileSync(process.platform === "win32" ? "powershell.exe" : "pwsh", [
		"-NoProfile",
		"-Command",
		`Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${extractDir}' -Force`,
	]);

	const manifest = JSON.parse(readFileSync(join(extractDir, "manifest.json"), "utf8"));
	if (manifest.commit !== pins.commit) {
		throw new Error(`沙盒包由 ${manifest.commit} 构建，期望 ${pins.commit}`);
	}

	const targetDir = join(repoRoot, "packages", "runtime-core", "sandbox", "bin");
	const staged = [];
	for (const name of WINDOWS_SANDBOX_BINARY_NAMES) {
		const source = join(extractDir, name);
		if (!existsSync(source)) throw new Error(`沙盒包里缺少 ${name}`);
		const expected = manifest.binaries.find((entry) => entry.name === name);
		const actual = await sha256File(source);
		if (!expected || expected.sha256 !== actual) throw new Error(`${name} 与 manifest 记录的哈希不一致`);
		if (!dryRun) {
			mkdirSync(targetDir, { recursive: true });
			copyFileSync(source, join(targetDir, name));
		}
		staged.push(join(targetDir, name));
		log(`[stage-native] ${name} → ${join(targetDir, name)}`);
	}

	// dry-run 只到校验为止：未写入目标目录，也就没有可执行文件可以探测。
	if (dryRun) {
		log("[stage-native] dry-run：已校验压缩包、manifest 与各二进制哈希，未写入");
		return { capabilities: manifest.capabilities, staged };
	}

	// 最后实跑一次能力探测：文件对不代表能跑（依赖缺失 / 架构不符都会在这一步露出来）。
	const hostPath = join(targetDir, WINDOWS_SANDBOX_BINARY_NAMES[0]);
	const probe = execFileSync(hostPath, ["--capabilities", "--json"], { encoding: "utf8" });
	const capabilities = JSON.parse(probe);
	if (capabilities.fullSandbox !== true) {
		throw new Error(`沙盒宿主自报能力不完整：${probe.trim()}`);
	}
	log(`[stage-native] 能力探测通过：fullSandbox=${capabilities.fullSandbox} backend=${capabilities.backend}`);

	return { capabilities, staged };
}

/** 从 `%LOCALAPPDATA%\Astravia\versions\<最高版本>` 里挑一个带 resources 的目录。 */
function findInstalledVersionDirs(env = process.env) {
	const base =
		env.ASTRAVIA_INSTALL_ROOT ??
		join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Astravia", "versions");
	if (!existsSync(base)) return [];
	return readdirSync(base)
		.map((name) => ({ name, path: join(base, name) }))
		.filter((entry) => existsSync(join(entry.path, "resources")))
		.sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }))
		.map((entry) => join(entry.path, "resources"));
}

function parseArgs(argv) {
	const args = { from: undefined, dryRun: false, sandboxRelease: false };
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === "--dry-run") args.dryRun = true;
		else if (value === "--sandbox-release") args.sandboxRelease = true;
		else if (value === "--from") args.from = argv[++index];
	}
	return args;
}

export function stageNativeBinaries({ resourcesDir, repoRoot, dryRun = false, log = console.log }) {
	const staged = [];
	const missing = [];

	const sandboxSource = join(resourcesDir, "sandbox", "windows");
	const sandboxTarget = join(repoRoot, "packages", "runtime-core", "sandbox", "bin");
	// 二进制清单与打包链共用一份：漏一个，打包时 stageWindowsSandboxBinaries 会直接抛错。
	for (const name of WINDOWS_SANDBOX_BINARY_NAMES) {
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
	const { from, dryRun, sandboxRelease } = parseArgs(process.argv.slice(2));
	const repoRoot = repoRootFromHere();

	if (sandboxRelease) {
		await stageSandboxFromRelease({ repoRoot, dryRun });
		console.log(`[stage-native] 沙盒已就位${dryRun ? "（dry-run，未写入）" : ""}；设置里的「使用沙盒」应可选`);
	} else {
		const candidates = from ? [from] : findInstalledVersionDirs();
		if (candidates.length === 0) {
			console.error(
				"[stage-native] 找不到已安装的 Astravia 版本目录。用 --from 指定 resources 目录，或用 --sandbox-release 下载沙盒发布包。",
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
}
