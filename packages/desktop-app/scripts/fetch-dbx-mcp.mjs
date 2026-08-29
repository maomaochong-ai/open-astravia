// Download the dbx-mcp native binary for Astravia's database integration (P7).
//
// Source: platform-dependent.
//   - win32-x64: Astravia's own build published as a GitHub Release on the fork
//     (https://github.com/sikongyue/dbx, upstream: https://github.com/t8y2/dbx).
//     The release asset `dbx-mcp-<version>-astravia-win-x64.exe` is built by
//     Astravia's own CI (fork `.github/workflows/dbx-mcp-astravia.yml`).
//   - darwin-arm64 / darwin-x64: official npm platform package
//     `@dbx-app/mcp-darwin-<arch>` (temporary source; switch to the fork
//     Release once the fork CI publishes macOS assets, see
//     docs/database/dbx-main-integration-tasks.md B2.2 后续 macOS 矩阵).
//
// Idempotent: skips when the target already exists and its SHA-256 matches the
// pinned digest. Version is locked on purpose (see docs/database/dbx-main-integration-tasks.md);
// upgrade = pull fork upstream -> review -> CI build -> update VERSION +
// EXPECTED_SHA256, then re-run.
//
// Override via env when needed:
//   DBX_MCP_VERSION=v0.4.61
//   DBX_MCP_SHA256=...
//   DBX_MCP_RELEASE=https://github.com/sikongyue/dbx/releases/download/dbx-mcp-astravia-v0.4.61

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const projectRoot = join(import.meta.dirname, "..");
const VERSION = process.env.DBX_MCP_VERSION ?? "0.4.61";
const RELEASE =
	process.env.DBX_MCP_RELEASE ??
	`https://github.com/sikongyue/dbx/releases/download/dbx-mcp-astravia-v${VERSION}`;

/**
 * 平台 → 二进制元信息。
 * - dir：resources/dbx-mcp/<dir>/ 目录名（与 dbx-mcp-path.ts 的解析一致）
 * - binaryName：二进制文件名（win 带 .exe）
 * - sha256：默认 pin（可用 DBX_MCP_SHA256 覆盖）；darwin 来自官方 npm 包 0.4.61
 *   解压后二进制实测（B1.1 先例，tarball 哈希另计）
 * - forkAsset：fork Release 资产名（`dbx-mcp-<ver>-astravia-<platform>`）；fork
 *   尚未发布 darwin 资产前为 null，走 npm-tarball 源
 */
const PLATFORMS = {
	"win32-x64": {
		dir: "win32-x64",
		binaryName: "dbx-mcp.exe",
		sha256:
			process.env.DBX_MCP_SHA256 ??
			"78957987da28600bedede19d3d731b756333f8d4f64bd3d553e0407413bd7ca8",
		forkAsset: `dbx-mcp-${VERSION}-astravia-win-x64.exe`,
	},
	"darwin-arm64": {
		dir: "darwin-arm64",
		binaryName: "dbx-mcp",
		sha256:
			process.env.DBX_MCP_SHA256 ??
			"059d87b0fbe8b56d82c6e457e98819f93eb06ada1b7874d3a94743270b844926",
		forkAsset: null,
	},
	"darwin-x64": {
		dir: "darwin-x64",
		binaryName: "dbx-mcp",
		sha256:
			process.env.DBX_MCP_SHA256 ??
			"20e39ba3d63376b98c5d34ca66bbb634ef898abd7183c93bdee06f24269f87e2",
		forkAsset: null,
	},
};

const HOST_PLATFORM = `${process.platform}-${process.arch}`;
const platform = PLATFORMS[HOST_PLATFORM];
if (!platform) {
	console.error(
		`[dbx-mcp] unsupported platform ${HOST_PLATFORM}; supported: ${Object.keys(PLATFORMS).join(", ")} (linux 待 fork CI 接入)`,
	);
	process.exit(1);
}

const targetBin = join(projectRoot, "resources/dbx-mcp", platform.dir, platform.binaryName);

function sha256File(path) {
	const data = readFile(path);
	return data.then((buf) => createHash("sha256").update(buf).digest("hex"));
}

async function fileExists(path) {
	try {
		const s = await stat(path);
		return s.isFile() && s.size > 0;
	} catch {
		return false;
	}
}

async function download(url, dest) {
	console.log(`[dbx-mcp] fetching: ${url}`);
	const res = await fetch(url, { redirect: "follow" });
	if (!res.ok || !res.body) {
		throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
	}
	await mkdir(dirname(dest), { recursive: true });
	const tmp = `${dest}.part`;
	const ws = createWriteStream(tmp);
	await pipeline(Readable.fromWeb(res.body), ws);
	await rename(tmp, dest);
}

/** 从官方 npm 平台包 tarball 解压出 `package/bin/dbx-mcp` 二进制。 */
async function extractNpmTarball(tarball, dest) {
	const dir = join(tmpdir(), `dbx-mcp-extract-${process.pid}`);
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });
	const result = spawnSync("tar", ["-xzf", tarball, "-C", dir], { stdio: "inherit" });
	if (result.status !== 0) {
		await rm(dir, { recursive: true, force: true });
		throw new Error(`tar extraction failed (status=${result.status})`);
	}
	const inner = join(dir, "package/bin/dbx-mcp");
	await copyFile(inner, dest);
	await rm(dir, { recursive: true, force: true });
}

async function main() {
	// 1. Skip if the target already exists with a matching digest.
	if (await fileExists(targetBin)) {
		const existing = await sha256File(targetBin);
		if (existing === platform.sha256) {
			console.log(`[dbx-mcp] cached: ${targetBin}`);
			return;
		}
		console.log(`[dbx-mcp] digest mismatch (${existing}), re-fetching`);
	}

	// 2. Download the binary for the current platform.
	const tmp = join(tmpdir(), `${platform.binaryName}-${VERSION}-${HOST_PLATFORM}`);
	await rm(tmp, { force: true });
	if (platform.forkAsset) {
		// fork Release 直链（自有构建，B2.3 起）。
		await download(`${RELEASE}/${platform.forkAsset}`, tmp);
	} else {
		// 官方 npm 平台包（过渡源；fork CI 产出 macOS 资产后切 fork 直链并更新 sha256）。
		const tarball = join(tmpdir(), `mcp-${platform.dir}-${VERSION}.tgz`);
		await download(
			`https://registry.npmmirror.com/@dbx-app/mcp-${platform.dir}/-/mcp-${platform.dir}-${VERSION}.tgz`,
			tarball,
		);
		await extractNpmTarball(tarball, tmp);
		await rm(tarball, { force: true });
	}
	const actual = await sha256File(tmp);
	if (actual !== platform.sha256) {
		throw new Error(`SHA-256 mismatch: expected ${platform.sha256}, got ${actual}`);
	}

	// 3. Install into resources/dbx-mcp/<platform>/.
	await mkdir(dirname(targetBin), { recursive: true });
	// copyFile (not rename): tmpdir and project may be on different drives (EXDEV).
	await copyFile(tmp, targetBin);
	await rm(tmp, { force: true });
	// macOS/Linux 需要可执行位；Windows 上无操作。
	try {
		await chmod(targetBin, 0o755);
	} catch {
		// best effort on Windows / FAT
	}

	const s = await stat(targetBin);
	console.log(
		`[dbx-mcp] ready: ${targetBin} (${(s.size / 1024 / 1024).toFixed(1)} MB, v${VERSION}, ${platform.forkAsset ? "Astravia build" : "official build"})`,
	);
}

main().catch((err) => {
	console.error("[dbx-mcp] failed:", err);
	process.exit(1);
});
