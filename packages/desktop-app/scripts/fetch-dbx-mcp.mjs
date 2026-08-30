// Download the dbx-mcp native binary for Astravia's database integration (P7).
//
// Source: platform-dependent. All three platforms use Astravia's own build published
// as a GitHub Release on the fork (https://github.com/maomaochong-ai/dbx, upstream:
// https://github.com/t8y2/dbx). Assets `dbx-mcp-<version>-astravia-<platform>` are
// built by Astravia's own CI (fork `.github/workflows/dbx-mcp-astravia.yml`);
// darwin switched to the fork direct link in B2.4 (previously official npm
// platform package `@dbx-app/mcp-darwin-<arch>`).
//
// Idempotent: skips when the target already exists and its SHA-256 matches the
// pinned digest. Version is locked on purpose (see docs/database/dbx-main-integration-tasks.md);
// upgrade = pull fork upstream -> review -> CI build -> update VERSION +
// EXPECTED_SHA256, then re-run.
//
// Override via env when needed:
//   DBX_MCP_VERSION=v0.4.61
//   DBX_MCP_SHA256=...
//   DBX_MCP_RELEASE=https://github.com/maomaochong-ai/dbx/releases/download/dbx-mcp-astravia-v0.4.61

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
	`https://github.com/maomaochong-ai/dbx/releases/download/dbx-mcp-astravia-v${VERSION}`;

/**
 * 平台 → 二进制元信息。
 * - dir：resources/dbx-mcp/<dir>/ 目录名（与 dbx-mcp-path.ts 的解析一致）
 * - binaryName：二进制文件名（win 带 .exe）
 * - sha256：默认 pin（可用 DBX_MCP_SHA256 覆盖）；三平台均来自 fork CI 产出的
 *   .sha256 文件（B2.4 起 macOS 亦切 fork 直链）
 * - forkAsset：fork Release 资产名（`dbx-mcp-<ver>-astravia-<platform>`），三平台齐备
const PLATFORMS = {
	"win32-x64": {
		dir: "win32-x64",
		binaryName: "dbx-mcp.exe",
		sha256:
			process.env.DBX_MCP_SHA256 ??
			"25484f9b5af527dd0af7dde44d9f2a929ad92b2c4cfe654c9460ca7be51950a8",
		forkAsset: `dbx-mcp-${VERSION}-astravia-win-x64.exe`,
	},
	"darwin-arm64": {
		dir: "darwin-arm64",
		binaryName: "dbx-mcp",
		sha256:
			process.env.DBX_MCP_SHA256 ??
			"7ef5d8cd0affe51caf33ab78263da9e78fb33dfb97264897dba2defd67c3845d",
		forkAsset: `dbx-mcp-${VERSION}-astravia-darwin-arm64`,
	},
	"darwin-x64": {
		dir: "darwin-x64",
		binaryName: "dbx-mcp",
		sha256:
			process.env.DBX_MCP_SHA256 ??
			"b48f619a4b33c35c3cd90a495cd2b9fb45506ee420de590afa830f50866c3f36",
		forkAsset: `dbx-mcp-${VERSION}-astravia-darwin-x64`,
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
