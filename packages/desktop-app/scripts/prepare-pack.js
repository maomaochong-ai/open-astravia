import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadBuildEnv } from "./load-build-env.mjs";
import { resolveReleaseInfo } from "./resolve-release-info.mjs";
import { resolveUpdatePublishConfig } from "./resolve-update-publish-config.mjs";
import { resolveTenant, stageSystemPluginsFromArchives } from "./stage-system-plugins.mjs";
import { stageSystemSkills } from "./stage-system-skills.mjs";
import { stageSystemThemesFromArchives } from "./stage-system-themes.mjs";

// 从 .env.<mode>/.env 注入构建期变量（如 VETTA_TENANT），命令行内联优先。
loadBuildEnv();
const updatePublishConfig = resolveUpdatePublishConfig();

const projectRoot = join(import.meta.dirname, "..");
const buildStageDir = join(tmpdir(), "vetta-desktop-build");
const vendorCacheDir = join(tmpdir(), "vetta-desktop-vendor-cache");
const imGatewayDir = join(projectRoot, "..", "im-gateway");
const imGatewayDistDir = join(imGatewayDir, "dist");
const codingAgentDir = join(projectRoot, "..", "coding-agent");
const cliAppDir = join(projectRoot, "..", "cli-app");
const runtimeCoreWindowsSandboxDir = join(projectRoot, "..", "runtime-core", "sandbox", "bin");
const runtimeCoreSandboxDir = join(projectRoot, "..", "runtime-core", "sandbox", "linux");
const cliAppCompileTargets = {
	"darwin-arm64": { platformTag: "darwin-arm64", bunTarget: "bun-darwin-arm64", binaryName: "vetta" },
	"darwin-x64": { platformTag: "darwin-x64", bunTarget: "bun-darwin-x64", binaryName: "vetta" },
	"linux-arm64": { platformTag: "linux-arm64", bunTarget: "bun-linux-arm64", binaryName: "vetta" },
	"linux-x64": { platformTag: "linux-x64", bunTarget: "bun-linux-x64", binaryName: "vetta" },
	"win32-x64": { platformTag: "win32-x64", bunTarget: "bun-windows-x64", binaryName: "vetta.exe" },
};
const imGatewayTargetByPlatformTag = {
	"darwin-arm64": { arch: "arm64", os: "darwin" },
	"darwin-x64": { arch: "amd64", os: "darwin" },
	"linux-arm64": { arch: "arm64", os: "linux" },
	"linux-x64": { arch: "amd64", os: "linux" },
	"win32-x64": { arch: "amd64", os: "windows" },
};

// Resolve electron version from the workspace
const require = createRequire(import.meta.url);
const electronPkgPath = require.resolve("electron/package.json");
const electronVersion = JSON.parse(readFileSync(electronPkgPath, "utf8")).version;
const sevenZipBinRoot = dirname(require.resolve("7zip-bin-full/package.json"));

// 正式发布以 packages/desktop-app/package.json 为唯一真源。本地更新闭环测试可用
// VETTA_DESKTOP_BUILD_VERSION 生成更高版本产物，不修改源码版本或创建 tag。
const packageVersion = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")).version;
const buildVersionOverride = process.env.VETTA_DESKTOP_BUILD_VERSION?.trim();
const appVersion = buildVersionOverride || packageVersion;
if (!/^\d+\.\d+\.\d+$/.test(appVersion)) {
	throw new Error(`[prepare-pack] invalid desktop version: ${appVersion}`);
}
if (buildVersionOverride && buildVersionOverride !== packageVersion) {
	console.warn(`[prepare-pack] QA build version override: ${packageVersion} -> ${appVersion}`);
}
const releaseInfo =
	appVersion === packageVersion ? resolveReleaseInfo(join(projectRoot, "CHANGELOG.md"), appVersion) : undefined;

function resolveCliAppCompileTargets() {
	const rawTargets = process.env.VETTA_CLI_TARGET_PLATFORMS ?? process.env.VETTA_VENDOR_PLATFORM;
	const platformTags =
		typeof rawTargets === "string" && rawTargets.trim().length > 0
			? rawTargets
					.split(",")
					.map((value) => value.trim())
					.filter(Boolean)
			: [`${process.platform}-${process.arch}`];

	return platformTags.map((platformTag) => {
		const target = cliAppCompileTargets[platformTag];
		if (!target) {
			throw new Error(
				`[prepare-pack] unsupported cli-app platform ${platformTag}; expected one of ${Object.keys(
					cliAppCompileTargets,
				).join(", ")}`,
			);
		}
		return target;
	});
}

function resolvePlatformTagsFromEnv() {
	const rawTargets =
		process.env.VETTA_IM_GATEWAY_TARGET_PLATFORMS ??
		process.env.VETTA_CLI_TARGET_PLATFORMS ??
		process.env.VETTA_VENDOR_PLATFORM;
	return typeof rawTargets === "string" && rawTargets.trim().length > 0
		? rawTargets
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean)
		: [`${process.platform}-${process.arch}`];
}

function resolveImGatewayTargets() {
	return resolvePlatformTagsFromEnv().map((platformTag) => {
		const target = imGatewayTargetByPlatformTag[platformTag];
		if (!target) {
			throw new Error(
				`[prepare-pack] unsupported im-gateway platform ${platformTag}; expected one of ${Object.keys(
					imGatewayTargetByPlatformTag,
				).join(", ")}`,
			);
		}
		return target;
	});
}

function resolvePlatformFamilies() {
	const families = new Set();
	for (const platformTag of resolvePlatformTagsFromEnv()) {
		if (platformTag.startsWith("darwin-")) families.add("darwin");
		else if (platformTag.startsWith("linux-")) families.add("linux");
		else if (platformTag.startsWith("win32-")) families.add("win32");
		else {
			throw new Error(
				`[prepare-pack] unsupported platform ${platformTag}; expected darwin-*, linux-*, or win32-*`,
			);
		}
	}
	return families;
}

// macOS 代码签名 / 公证：凭据齐全时自动开启，一个都不设时保持未签名产物。
// 变量含义与申请流程见 docs/deploy/apple-code-signing.md。
const MAC_SIGN_ENV_KEYS = [
	"CSC_LINK",
	"CSC_NAME",
	"APPLE_TEAM_ID",
	"APPLE_ID",
	"APPLE_APP_SPECIFIC_PASSWORD",
	"APPLE_API_KEY",
	"APPLE_API_KEY_ID",
	"APPLE_API_ISSUER",
];

function resolveMacSigning() {
	const has = (key) => typeof process.env[key] === "string" && process.env[key].trim().length > 0;
	if (!MAC_SIGN_ENV_KEYS.some(has)) return { enabled: false };

	// 半配置状态最危险：签了名却没公证的产物照样被 Gatekeeper 拦，
	// 而 DMG 里的修复助手此时已被移除。宁可直接失败。
	const missing = [];
	if (!has("CSC_LINK") && !has("CSC_NAME")) missing.push("CSC_LINK 或 CSC_NAME");
	if (!has("APPLE_TEAM_ID")) missing.push("APPLE_TEAM_ID");
	const hasApiKey = has("APPLE_API_KEY") && has("APPLE_API_KEY_ID") && has("APPLE_API_ISSUER");
	const hasAppleId = has("APPLE_ID") && has("APPLE_APP_SPECIFIC_PASSWORD");
	if (!hasApiKey && !hasAppleId) {
		missing.push("APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER，或 APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD");
	}
	if (missing.length > 0) {
		throw new Error(
			`[prepare-pack] macOS 签名凭据不完整，缺少：${missing.join("；")}。` +
				"申请与注入流程见 docs/deploy/apple-code-signing.md；要出未签名包请清空所有 CSC_* / APPLE_* 变量。",
		);
	}
	return { enabled: true, teamId: process.env.APPLE_TEAM_ID.trim() };
}

const macSigning = resolveMacSigning();
console.log(
	macSigning.enabled
		? `[prepare-pack] macOS 签名与公证已启用（team=${macSigning.teamId}）`
		: "[prepare-pack] macOS 签名凭据未配置，产出未签名包",
);

function resolveBuildResourceFilters() {
	const filters = new Set(["pet/**/*"]);
	const families = resolvePlatformFamilies();
	if (families.has("darwin")) {
		filters.add("icon.icns");
		filters.add("icon.png");
		filters.add("icon-dock.png");
	}
	if (families.has("linux")) {
		filters.add("icon.png");
	}
	if (families.has("win32")) {
		filters.add("icon.ico");
	}
	return [...filters];
}

function resolveSandboxResourceFilters() {
	const filters = new Set();
	const families = resolvePlatformFamilies();
	if (families.has("win32")) filters.add("windows/**/*");
	if (families.has("linux")) filters.add("linux/**/*");
	return [...filters];
}

// Copy externalized dependencies (not bundled by Vite due to ESM compatibility issues).
//
// Some packages (e.g. modern node-cron) restrict their `exports` map and no
// longer allow `require.resolve("<pkg>/package.json")`. Resolve the package's
// main entry instead and trim the path back to the package root inside
// node_modules. This works regardless of how the package author configured
// `exports`.
// 与 vite.main.config.ts 的 rollupOptions.external 保持同步。photon-node 在
// 主 bundle 被 external 后，代码里 createRequire("@silvia-odwyer/photon-node")
// 在 packaged AppImage 中找不到包就降级到原图（image-resize 早期日志的
// `Cannot find module '@silvia-odwyer/photon-node'` 即此），图片以原始分辨率
// 喂模型，长会话直接吃满主进程内存。把它复制进 staging/node_modules 让
// createRequire 真能 resolve 到，恢复图片缩放路径。photon-node 是纯 WASM、
// 无平台二进制差异，可安全跨平台打包。
//
// uiohook-napi（快捷面板双击功能键全局监听）与 electron-liquid-glass（macOS
// 液态/磨砂玻璃）同为被 external 的运行时原生模块，必须一并复制进 staging，
// 否则 packaged 环境 require 不到。uiohook 各平台都有 prebuild、需全平台带；
// electron-liquid-glass 是 darwin-only（`os:["darwin"]`），仅 mac 主机/包需要，
// 非 mac 主机上可能未安装，故标记为 optional：解析不到就跳过、不阻断打包。
const externalDeps = ["@silvia-odwyer/photon-node", "builder-util-runtime", "electron-updater", "uiohook-napi"];
const optionalExternalDeps = ["electron-liquid-glass"];

function resolvePackageRoot(dep, fromDir = projectRoot) {
	const entry = require.resolve(dep, { paths: [fromDir] });
	const marker = `${join("node_modules", dep)}${process.platform === "win32" ? "\\" : "/"}`;
	const idx = entry.lastIndexOf(marker);
	if (idx < 0) {
		throw new Error(`prepare-pack: cannot locate ${dep} package root in ${entry}`);
	}
	return entry.slice(0, idx + marker.length - 1);
}

// Copy an external dep plus its full production-dependency closure into the
// staged node_modules. app-builder-lib 26's bun collector walks each package's
// declared `dependencies` and hard-fails when one is missing from the staged
// tree (e.g. uiohook-napi → node-gyp-build, electron-liquid-glass → bindings /
// node-addon-api). Transitive deps are nested under the owner's node_modules so
// both the collector and runtime require() resolve them; the asarUnpack glob
// `node_modules/<dep>/**/*` then unpacks them alongside the native module.
function stageDepTree(dep, sourceDir, destDir, seen = new Set()) {
	cpSync(sourceDir, destDir, { recursive: true });
	const pkg = JSON.parse(readFileSync(join(sourceDir, "package.json"), "utf8"));
	for (const transDep of Object.keys(pkg.dependencies ?? {})) {
		const key = `${dep}>${transDep}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const transDir = resolvePackageRoot(transDep, sourceDir);
		stageDepTree(transDep, transDir, join(destDir, "node_modules", transDep), seen);
	}
}

function toExternalDepInfo(dep) {
	const dir = resolvePackageRoot(dep);
	const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	if (typeof pkg.version !== "string" || !pkg.version) {
		throw new Error(`prepare-pack: ${dep} package.json is missing a version`);
	}
	return { dep, dir, version: pkg.version };
}

const externalDepInfos = externalDeps.map(toExternalDepInfo);
for (const dep of optionalExternalDeps) {
	try {
		externalDepInfos.push(toExternalDepInfo(dep));
	} catch {
		console.warn(`[prepare-pack] optional external dep ${dep} not resolvable on this host; skipping`);
	}
}

function assertPackagedMainHasNoWorkspaceImports(mainOutputDir) {
	const workspaceImportPattern = /^\s*import(?:\s+.+\s+from)?\s+["']@vetta\//;
	const invalidImports = [];
	for (const fileName of readdirSync(mainOutputDir)) {
		if (!fileName.endsWith(".js")) continue;
		const lines = readFileSync(join(mainOutputDir, fileName), "utf8").split(/\r?\n/);
		for (const [index, line] of lines.entries()) {
			if (workspaceImportPattern.test(line)) invalidImports.push(`${fileName}:${index + 1}: ${line.trim()}`);
		}
	}
	if (invalidImports.length > 0) {
		throw new Error(
			"[prepare-pack] desktop main output contains external @vetta workspace imports. " +
				"Rebuild main with VETTA_BUILD_ENV=production before packaging:\n" +
				invalidImports.join("\n"),
		);
	}
}

assertPackagedMainHasNoWorkspaceImports(join(projectRoot, "dist/main"));

// Clean previous build stage
rmSync(buildStageDir, { recursive: true, force: true });
mkdirSync(buildStageDir, { recursive: true });

// Write the staged package metadata. Electron-builder decides which
// node_modules entries belong in app.asar from production dependencies, so
// externalized runtime deps must be declared here even though we copy them
// manually below.
const appPkg = {
	name: "vetta",
	version: appVersion,
	description: "Vetta Desktop App",
	author: "Vetta",
	type: "module",
	main: "main/index.js",
	dependencies: Object.fromEntries(externalDepInfos.map(({ dep, version }) => [dep, version])),
};
writeFileSync(join(buildStageDir, "package.json"), JSON.stringify(appPkg, null, "\t") + "\n");

// Copy build outputs
cpSync(join(projectRoot, "dist/main"), join(buildStageDir, "main"), { recursive: true });
cpSync(join(projectRoot, "dist/preload"), join(buildStageDir, "preload"), { recursive: true });
cpSync(join(projectRoot, "dist/renderer"), join(buildStageDir, "renderer"), { recursive: true });
// OCR headless runner: dedicated hidden BrowserWindow entry + its preload.
// The CLI flow `Vetta --ocr-pdf <pdf> --output <json>` loads this HTML and
// drives the per-page render + OCR pipeline inside Electron's renderer.
cpSync(join(projectRoot, "dist/ocr-preload"), join(buildStageDir, "ocr-preload"), { recursive: true });
cpSync(join(projectRoot, "dist/ocr-runner"), join(buildStageDir, "ocr-runner"), { recursive: true });

// macOS DMG: 生成背景图（写入 repo build/，下面 cpSync 会一并带到 staging）。
// 仅 darwin host 跑；非 darwin 上即使存在 mac target，也不会真正出 dmg。
// 签名构建没有「已损坏」问题，不带修复助手，背景图退回两图标版式。
if (process.platform === "darwin") {
	execFileSync(
		"node",
		[join(import.meta.dirname, "generate-dmg-background.js"), ...(macSigning.enabled ? ["--two-icons"] : [])],
		{ stdio: "inherit" },
	);
}

// Copy icons
cpSync(join(projectRoot, "build"), join(buildStageDir, "build"), { recursive: true });

// macOS DMG: 编译「修复已损坏.app」直接落到 staging build/，由下面 dmg.contents 引用。
// 仅未签名构建需要；签名+公证后 quarantine 不再拦截，且该 helper 自身未签名会拖累公证。
if (process.platform === "darwin" && !macSigning.enabled) {
	execFileSync(
		"node",
		[join(import.meta.dirname, "build-mac-repair-helper.js"), join(buildStageDir, "build")],
		{ stdio: "inherit" },
	);
}

// macOS appshot: swiftc 编译 "Vetta Computer Use.app" 直接落到 staging appshot/，
// 由 resolveExtraResources 带进 Resources/appshot/（filter "**/*" 递归带入
// .app bundle 内部结构）。仅 darwin host 可编译。
if (process.platform === "darwin") {
	execFileSync(
		"node",
		[join(import.meta.dirname, "build-appshot-helper.js"), "--out", join(buildStageDir, "appshot")],
		{ stdio: "inherit" },
	);
}

for (const { dep, dir } of externalDepInfos) {
	stageDepTree(dep, dir, join(buildStageDir, "node_modules", dep));
}

// =============================================================================
// im-gateway sidecar binaries (extraResources)
// =============================================================================
//
// Build the Go binaries for the requested target platform(s), then copy them
// into the staged Resources/im-gateway/ directory so electron-builder picks
// them up via extraResources. This intentionally avoids shell-specific Makefile
// logic so Windows packaging works the same way as POSIX hosts.

console.log("[prepare-pack] cross-building im-gateway sidecar...");
rmSync(imGatewayDistDir, { recursive: true, force: true });
mkdirSync(imGatewayDistDir, { recursive: true });

for (const target of resolveImGatewayTargets()) {
	const extension = target.os === "windows" ? ".exe" : "";
	const outputPath = join(imGatewayDistDir, `im-gateway-${target.os}-${target.arch}${extension}`);
	console.log(`  -> ${outputPath}`);
	try {
		execFileSync(process.platform === "win32" ? "go.exe" : "go", [
			"build",
			"-trimpath",
			"-ldflags",
			"-s -w -X main.version=dev",
			"-o",
			outputPath,
			"./cmd/im-gateway",
		], {
			cwd: imGatewayDir,
			env: {
				...process.env,
				CGO_ENABLED: "0",
				GOARCH: target.arch,
				GOOS: target.os,
			},
			stdio: "inherit",
		});
	} catch (err) {
		console.error("[prepare-pack] im-gateway cross-build failed");
		throw err;
	}
}

const stagedImGatewayDir = join(buildStageDir, "im-gateway");
mkdirSync(stagedImGatewayDir, { recursive: true });
if (existsSync(imGatewayDistDir)) {
	for (const file of readdirSync(imGatewayDistDir)) {
		if (!file.startsWith("im-gateway-")) continue;
		const src = join(imGatewayDistDir, file);
		const dest = join(stagedImGatewayDir, file);
		cpSync(src, dest);
		// Ensure executable bit is preserved (zip extraction sometimes
		// strips it; we set it explicitly so spawn() works after install).
		try {
			chmodSync(dest, 0o755);
		} catch {
			// best effort on Windows / FAT
		}
	}
} else {
	throw new Error(`im-gateway dist dir not found after cross-build: ${imGatewayDistDir}`);
}

// =============================================================================
// coding-agent runtime assets (extraResources)
// =============================================================================
//
// The bundled main-*.js (Vite output) contains `@vetta/coding-agent`'s JS
// but not its on-disk package tree. Stage the full dist plus metadata into
// Resources/coding-agent/. macOS/Linux agent-rpc-command.ts uses it as
// VETTA_PACKAGE_DIR for assets; Windows additionally runs dist/cli.js via
// ELECTRON_RUN_AS_NODE because GUI Electron stdio is not reliable for RPC.
const stagedCodingAgentDir = join(buildStageDir, "coding-agent");
rmSync(stagedCodingAgentDir, { recursive: true, force: true });
mkdirSync(stagedCodingAgentDir, { recursive: true });
const codingAgentAssets = [
	"package.json",
	"banner.txt",
	"README.md",
	"CHANGELOG.md",
	"dist",
];
for (const rel of codingAgentAssets) {
	const src = join(codingAgentDir, rel);
	if (!existsSync(src)) {
		// banner / README / CHANGELOG are best-effort; theme + export-html
		// are required and would have failed the build at this point if
		// missing from the source repo.
		continue;
	}
	cpSync(src, join(stagedCodingAgentDir, rel), { recursive: true });
}
const bundledAgentRpcCli = join(stagedCodingAgentDir, "dist", "agent-rpc-cli.mjs");
console.log(`[prepare-pack] bundling Windows agent-rpc CLI -> ${bundledAgentRpcCli}`);
execFileSync(process.platform === "win32" ? "bun.exe" : "bun", [
	"build",
	join(codingAgentDir, "dist", "cli.js"),
	"--target",
	"node",
	"--format",
	"esm",
	"--outfile",
	bundledAgentRpcCli,
], {
	cwd: projectRoot,
	stdio: "inherit",
});
// Sanity-check the load-bearing files are actually in the stage dir.
const stagedThemeDir = join(stagedCodingAgentDir, "dist/modes/interactive/theme");
if (!existsSync(join(stagedThemeDir, "dark.json"))) {
	throw new Error(`coding-agent theme assets missing after stage: ${stagedThemeDir}`);
}
if (!existsSync(bundledAgentRpcCli)) {
	throw new Error(`bundled agent-rpc CLI missing after stage: ${bundledAgentRpcCli}`);
}

// =============================================================================
// vetta CLI app (extraResources)
// =============================================================================
//
// The agent-facing `vetta` command is @vetta/cli-app, not the desktop
// executable. Stage it into Resources/cli-app/ so Desktop can write
// ~/.vetta/agent/bin/vetta as a stable shim to this entry.
const stagedCliAppDir = join(buildStageDir, "cli-app");
rmSync(stagedCliAppDir, { recursive: true, force: true });
mkdirSync(stagedCliAppDir, { recursive: true });
cpSync(join(cliAppDir, "package.json"), join(stagedCliAppDir, "package.json"));
console.log("[prepare-pack] building cli-app...");
execFileSync(process.platform === "win32" ? "bun.exe" : "bun", ["run", "build"], {
	cwd: cliAppDir,
	stdio: "inherit",
});
for (const target of resolveCliAppCompileTargets()) {
	const stagedCliAppBinDir = join(stagedCliAppDir, "bin", target.platformTag);
	const stagedCliAppBinary = join(stagedCliAppBinDir, target.binaryName);
	mkdirSync(stagedCliAppBinDir, { recursive: true });
	console.log(`[prepare-pack] compiling vetta CLI (${target.platformTag}) -> ${stagedCliAppBinary}`);
	execFileSync(process.platform === "win32" ? "bun.exe" : "bun", [
		"build",
		join(cliAppDir, "src", "cli.ts"),
		"--compile",
		"--target",
		target.bunTarget,
		"--outfile",
		stagedCliAppBinary,
	], {
		cwd: projectRoot,
		stdio: "inherit",
	});
	if (!existsSync(stagedCliAppBinary)) {
		throw new Error(`[prepare-pack] compiled cli-app binary missing after stage: ${stagedCliAppBinary}`);
	}
	try {
		chmodSync(stagedCliAppBinary, 0o755);
	} catch {
		// best effort on Windows / FAT
	}
}

// =============================================================================
// Sandbox binaries (extraResources)
// =============================================================================
//
// Sandbox executables live under Resources/sandbox/<platform>/ so the Electron
// main process can resolve them from process.resourcesPath after packaging.
const stagedSandboxDir = join(buildStageDir, "sandbox");
mkdirSync(stagedSandboxDir, { recursive: true });
if (existsSync(runtimeCoreWindowsSandboxDir)) {
	const stagedWindowsSandboxDir = join(stagedSandboxDir, "windows");
	mkdirSync(stagedWindowsSandboxDir, { recursive: true });
	cpSync(runtimeCoreWindowsSandboxDir, stagedWindowsSandboxDir, { recursive: true });

	for (const file of readdirSync(stagedWindowsSandboxDir)) {
		const binaryPath = join(stagedWindowsSandboxDir, file);
		if (!existsSync(binaryPath)) continue;
		try {
			chmodSync(binaryPath, 0o755);
		} catch {
			// best effort on Windows / FAT
		}
	}
}

if (existsSync(runtimeCoreSandboxDir)) {
	const stagedLinuxSandboxDir = join(stagedSandboxDir, "linux");
	mkdirSync(stagedLinuxSandboxDir, { recursive: true });
	cpSync(runtimeCoreSandboxDir, stagedLinuxSandboxDir, { recursive: true });

	for (const arch of readdirSync(stagedLinuxSandboxDir)) {
		const binaryPath = join(stagedLinuxSandboxDir, arch, "bwrap");
		if (!existsSync(binaryPath)) continue;
		try {
			chmodSync(binaryPath, 0o755);
		} catch {
			// best effort on Windows / FAT
		}
	}
}

// =============================================================================
// 托管运行时 vendor 二进制 (extraResources) —— ADR-0011
// =============================================================================
//
// 把当前构建目标平台的 Node + Python(python-build-standalone)二进制内置进
// Resources/vendor/{node,python}/,首启时由 main 进程拷贝到 ~/.vetta/runtimes/。
// 这是普通用户「下载下来就有环境」的本体。Node 走 npmmirror、Python 走 GitHub
// (国内无稳定公共镜像,故必须内置)。构建机有网即可;无法联网的构建可设
// VETTA_SKIP_VENDOR=1 跳过(产物退化为「面板手动下载」,不推荐发版用)。
//
// 默认按构建宿主平台;跨平台打包请设 VETTA_VENDOR_PLATFORM,取值与
// src/main/runtimes/manifest.json 的 platforms 键一致(如 darwin-arm64 /
// win32-x64 / linux-x64)。
async function stageVendorRuntimes() {
	if (process.env.VETTA_SKIP_VENDOR === "1") {
		console.warn("[prepare-pack] VETTA_SKIP_VENDOR=1 —— 跳过内置运行时,产物将依赖面板手动下载");
		return;
	}
	const manifestPath = join(projectRoot, "src", "main", "runtimes", "manifest.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const platformTag = process.env.VETTA_VENDOR_PLATFORM || `${process.platform}-${process.arch}`;
	const stagedVendorDir = join(buildStageDir, "vendor");

	for (const type of ["node", "python"]) {
		const def = manifest[type];
		const entry = def.platforms[platformTag];
		if (!entry) {
			throw new Error(
				`[prepare-pack] manifest 缺少 ${type} 平台 ${platformTag};跨平台打包请设 VETTA_VENDOR_PLATFORM`,
			);
		}
		const destTypeDir = join(stagedVendorDir, type);
		const extractedDir = join(destTypeDir, entry.dir);
		const versionMarker = join(extractedDir, ".vendor-version");
		// 已就绪且版本一致 → 跳过(加速迭代构建)
		if (existsSync(versionMarker) && readFileSync(versionMarker, "utf8").trim() === def.version) {
			console.log(`[prepare-pack] vendor ${type} ${def.version} 已就绪,跳过`);
			continue;
		}
		rmSync(destTypeDir, { recursive: true, force: true });
		mkdirSync(destTypeDir, { recursive: true });

		const urls = def.sources.map((tpl) =>
			tpl
				.replace("{version}", def.version)
				.replace("{release}", def.release ?? "")
				.replace("{filename}", entry.filename),
		);
		const cacheTypeDir = join(vendorCacheDir, platformTag, type);
		const archivePath = join(cacheTypeDir, entry.filename);
		mkdirSync(cacheTypeDir, { recursive: true });

		let readyArchive = existsSync(archivePath);
		if (readyArchive) {
			console.log(`[prepare-pack] using cached vendor ${type} archive -> ${archivePath}`);
		}
		for (const url of urls) {
			if (readyArchive) break;
			try {
				console.log(`[prepare-pack] downloading vendor ${type} <- ${url}`);
				const res = await fetch(url, { redirect: "follow" });
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				writeFileSync(archivePath, Buffer.from(await res.arrayBuffer()));
				readyArchive = true;
				break;
			} catch (err) {
				console.warn(`[prepare-pack] download failed (${url}): ${err.message}`);
			}
		}
		if (!readyArchive) {
			throw new Error(`[prepare-pack] 无法下载 vendor ${type}(${platformTag});检查构建机网络或设 VETTA_SKIP_VENDOR=1`);
		}

		// 解压:系统 tar 同时处理 tar.gz 与 zip(Win10+/bsdtar)。
		execFileSync("tar", ["-xf", archivePath, "-C", destTypeDir], { stdio: "inherit" });
		if (!existsSync(extractedDir)) {
			throw new Error(`[prepare-pack] vendor ${type} 解压后未找到预期目录: ${extractedDir}`);
		}
		writeFileSync(versionMarker, def.version);
		console.log(`[prepare-pack] vendor ${type} ${def.version} staged -> ${extractedDir}`);
	}
}

await stageVendorRuntimes();

// =============================================================================
// 系统插件（extraResources）—— ADR-0024
// =============================================================================
//
// build:presets 已为每个 preset 生成 release/<id>-<version>.zip。打包阶段只消费
// zip 制品，校验后解压到 Resources/system-plugins/<id>/，不读取源码 dist。
// 按租户（VETTA_TENANT，缺省取 tenants.json 的 default）筛选打包进 App 的系统插件。
const packTenant = resolveTenant();
console.log(
	`[prepare-pack] 系统插件租户=${packTenant.name ?? "(未配置)"}：${
		packTenant.pluginIds ? [...packTenant.pluginIds].join(", ") : "(全部 preset)"
	}`,
);
stageSystemPluginsFromArchives(join(buildStageDir, "system-plugins"), "prepare-pack", {
	pluginIds: packTenant.pluginIds ?? undefined,
});
stageSystemThemesFromArchives(join(buildStageDir, "system-themes"), "prepare-pack");
stageSystemSkills(join(buildStageDir, "system-skills"), "prepare-pack");

function resolveExtraResources() {
	const extraResources = [
		{
			from: "im-gateway",
			to: "im-gateway",
			filter: ["im-gateway-*"],
		},
		{
			from: "coding-agent",
			to: "coding-agent",
			filter: ["**/*", "!**/*.map"],
		},
		{
			from: "cli-app",
			to: "cli-app",
			filter: ["**/*"],
		},
		{
			from: "vendor",
			to: "vendor",
			filter: ["**/*", "!**/*.pdb"],
		},
		{
			from: "system-plugins",
			to: "system-plugins",
			filter: ["**/*"],
		},
		{
			from: "system-skills",
			to: "system-skills",
			filter: ["**/*"],
		},
		{
			from: "system-themes",
			to: "system-themes",
			filter: ["**/*"],
		},
		{
			from: "build",
			to: "build",
			filter: resolveBuildResourceFilters(),
		},
	];
	const sandboxFilters = resolveSandboxResourceFilters();
	if (sandboxFilters.length > 0) {
		extraResources.push({
			from: "sandbox",
			to: "sandbox",
			filter: sandboxFilters,
		});
	}
	// "Vetta Computer Use.app" 仅 darwin 目标需要，且仅 darwin host 能编译（见上方 staging）。
	if (resolvePlatformFamilies().has("darwin") && process.platform === "darwin") {
		extraResources.push({
			from: "appshot",
			to: "appshot",
			filter: ["**/*"],
		});
	}
	if (resolvePlatformFamilies().has("win32")) {
		extraResources.push({
			from: join(sevenZipBinRoot, "win", "x64"),
			to: "tools/7zip",
			filter: ["7z.dll", "7z.exe"],
		});
	}
	return extraResources;
}

// Write electron-builder config
const builderConfig = {
	appId: "com.vetta.desktop",
	productName: "Vetta",
	executableName: "Vetta",
	afterPack: join(projectRoot, "scripts", "windows-version-layout.mjs"),
	electronVersion,
	electronLanguages: ["zh-CN", "en-US"],
	npmRebuild: false,
	...(updatePublishConfig ? { publish: [updatePublishConfig] } : {}),
	...(releaseInfo ? { releaseInfo } : {}),
	protocols: {
		name: "Vetta",
		schemes: ["vetta"],
	},
	mac: {
		target: ["dmg", "zip"],
		category: "public.app-category.productivity",
		icon: "build/icon.icns",
		// 签名/公证开关由 resolveMacSigning() 按环境变量决定（见
		// docs/deploy/apple-code-signing.md）：凭据齐全 → Developer ID 签名 +
		// hardened runtime + 公证；一个都不设 → 维持未签名产物，配套 DMG 里的
		// 「修复已损坏.app」。签名身份由 electron-builder 从 CSC_LINK / CSC_NAME
		// 自动发现，因此签名分支不写 identity。
		...(macSigning.enabled
			? {
					hardenedRuntime: true,
					gatekeeperAssess: false,
					entitlements: "build/entitlements.mac.plist",
					entitlementsInherit: "build/entitlements.mac.inherit.plist",
					// electron-builder 26 起 notarize 只接受布尔值，团队与密钥
					// 一律从 APPLE_TEAM_ID / APPLE_API_* 环境变量读取。
					notarize: true,
				}
			: {
					identity: null,
					notarize: false,
					hardenedRuntime: false,
				}),
		// 用户的本地模型（Ollama / LM Studio / vLLM 等）通常监听在局域网
		// 明文 HTTP（http://192.168.x.x:port）。macOS 14+ 的 TCC 与 ATS 默认
		// 会静默拦截这种请求，表现为 Finder 双击启动后随机出现 "Connection
		// error."，而从终端启动 Vetta 时 launchd context 不同会偶发放行。
		// 三个 key 缺一不可：
		//   - NSAppTransportSecurity.NSAllowsLocalNetworking：放开局域网明文 HTTP
		//   - NSLocalNetworkUsageDescription：macOS 14+ 触发本地网络权限弹窗
		//   - NSBonjourServices：协助 TCC 识别 app 需要本地网络访问
		extendInfo: {
			NSAppTransportSecurity: {
				NSAllowsLocalNetworking: true,
			},
			NSLocalNetworkUsageDescription:
				"Vetta 需要访问本地网络以连接你在局域网内运行的 AI 模型服务（如 Ollama、LM Studio、vLLM 等）。",
			NSBonjourServices: ["_http._tcp", "_https._tcp"],
		},
	},
	// DMG 视觉与图标布局。详见 docs/adr/0003-dmg-repair-helper.md。
	// 坐标以 @1x 660×440 为准；背景图 build/background.png 与 build/background@2x.png
	// 由 scripts/generate-dmg-background.js 在 prebuild 阶段生成（两种版式的图标
	// 位置必须与那里的 ICON_CENTERS_X_2X 对齐）。
	// 未签名构建为三图标：多出的「修复已损坏.app」由 scripts/build-mac-repair-helper.js
	// osacompile 生成，用户首次需 control-click → 「打开」绕过 Gatekeeper，
	// 之后弹原生密码框对 /Applications/Vetta.app 执行 xattr -dr com.apple.quarantine。
	// 签名+公证构建不存在「已损坏」问题，退回两图标常规版式。
	dmg: {
		background: "build/background.png",
		window: { width: 660, height: 440 },
		iconSize: 100,
		iconTextSize: 12,
		contents: macSigning.enabled
			? [
					{ x: 180, y: 200, type: "file" }, // Vetta.app（electron-builder 自动填入产物路径）
					{ x: 480, y: 200, type: "link", path: "/Applications" },
				]
			: [
					{ x: 100, y: 200, type: "file" },
					{ x: 330, y: 200, type: "link", path: "/Applications" },
					{ x: 560, y: 200, type: "file", path: join(buildStageDir, "build", "修复已损坏.app") },
				],
	},
	win: {
		target: ["nsis"],
		artifactName: "${productName}-${version}-win-${arch}.${ext}",
		icon: "build/icon.ico",
	},
	linux: {
		target: ["AppImage"],
		category: "Utility",
		icon: "build/icon.png",
	},
	// Sidecar binaries are picked up from the staged ./im-gateway dir
	// (populated above by the cross-build step).
	extraResources: resolveExtraResources(),
	nsis: {
		oneClick: false,
		perMachine: false,
		allowToChangeInstallationDirectory: true,
		include: "build/installer.nsh",
	},
	directories: {
		output: join(projectRoot, "release"),
	},
	asar: true,
	disableSanityCheckAsar: resolvePlatformFamilies().has("win32"),
	// photon-node 是 createRequire 加载的 external 包，其 photon_rs_bg.wasm
	// 通过 readFileSync(__dirname + "/photon_rs_bg.wasm") 读取。asar 虚拟
	// 文件系统对 readFileSync 透明，但 wasm 这类二进制在部分 Electron 版本
	// 上偶尔出问题（photon.ts 已经有 fallback paths 兜底，但能避免就避免）。
	// 直接 unpack 到 app.asar.unpacked/，让 wasm 落到真实文件系统。
	//
	// uiohook-napi / electron-liquid-glass 通过 node-gyp-build 加载预编译 .node。
	// dlopen 无法从 asar 虚拟文件系统加载原生模块，必须整包 unpack 到真实磁盘，
	// 否则 packaged 环境 require 即失败（electron-liquid-glass 仅 mac 包内存在）。
	asarUnpack: [
		"node_modules/@silvia-odwyer/photon-node/**/*",
		"node_modules/uiohook-napi/**/*",
		"node_modules/electron-liquid-glass/**/*",
	],
};
writeFileSync(join(buildStageDir, "electron-builder.json"), JSON.stringify(builderConfig, null, "\t") + "\n");

console.log(`build staged at: ${buildStageDir}`);
