#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const repoRoot = resolve(import.meta.dirname, "..");
const desktopDir = join(repoRoot, "packages", "desktop-app");
const releaseDir = join(desktopDir, "release");
const desktopPackagePath = join(desktopDir, "package.json");
const bunExecutable = process.platform === "win32" ? "bun.exe" : "bun";
const requireFromDesktop = createRequire(desktopPackagePath);
const { parse: parseEnv } = requireFromDesktop("dotenv");
const stableEnvironmentKeys = [
	"VETTA_SERVER_URL",
	"VETTA_SITE_URL",
	"VETTA_UPDATE_PROVIDER",
	"VETTA_UPDATE_URL",
	"VETTA_R2_BUCKET",
	"VETTA_R2_PREFIX",
];

function usage(exitCode = 1) {
	console.log(`Windows 桌面端构建 + R2 发布：

  bun scripts/release-windows.mjs test --version 0.5.61
  bun scripts/release-windows.mjs stable

可选参数：
  --check-only    只执行前置校验，不清理 release/、不构建
  --skip-publish  构建并校验产物，但不上传 R2
  --yes           跳过 stable 发布前的版本号确认

配置优先级：当前 Shell > ~/.config/vetta/r2-<channel>.env
            > ~/.config/vetta/r2.env > desktop-app 对应环境文件

test 读取 packages/desktop-app/.env.development，且必须显式指定版本；
stable 的服务器、站点和发布目标强制读取 .env.production，版本只取 package.json。`);
	process.exit(exitCode);
}

function fail(message) {
	throw new Error(`[release-windows] ${message}`);
}

function step(message) {
	console.log(`\n==> ${message}`);
}

function parseArguments(argv) {
	if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) usage(0);
	const channel = argv[0];
	if (channel !== "test" && channel !== "stable") usage();

	const options = {
		channel,
		version: undefined,
		checkOnly: false,
		skipPublish: false,
		assumeYes: false,
	};
	for (let index = 1; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--version") {
			const version = argv[index + 1];
			if (!version) fail("--version 缺少值");
			options.version = version;
			index += 1;
			continue;
		}
		if (argument === "--check-only") {
			options.checkOnly = true;
			continue;
		}
		if (argument === "--skip-publish") {
			options.skipPublish = true;
			continue;
		}
		if (argument === "--yes") {
			options.assumeYes = true;
			continue;
		}
		fail(`未知参数：${argument}`);
	}
	return options;
}

function loadEnvironment(channel) {
	const inheritedEnvironment = { ...process.env };
	const environmentFiles = [
		join(desktopDir, channel === "stable" ? ".env.production" : ".env.development"),
		join(homedir(), ".config", "vetta", "r2.env"),
		join(homedir(), ".config", "vetta", `r2-${channel}.env`),
	];
	const loadedFiles = [];
	for (const filePath of environmentFiles) {
		if (!existsSync(filePath)) continue;
		Object.assign(process.env, parseEnv(readFileSync(filePath)));
		loadedFiles.push(filePath);
	}
	Object.assign(process.env, inheritedEnvironment);
	return loadedFiles;
}

function enforceStableEnvironment() {
	const productionEnvironmentPath = join(desktopDir, ".env.production");
	const productionEnvironment = parseEnv(readFileSync(productionEnvironmentPath));
	for (const name of stableEnvironmentKeys) {
		const value = productionEnvironment[name]?.trim();
		if (!value) fail(`.env.production 缺少 ${name}`);
		process.env[name] = value;
	}
}

function requireEnvironment(name) {
	const value = process.env[name]?.trim();
	if (!value) fail(`缺少 ${name}`);
	return value;
}

function normalizePrefix(value) {
	return value
		.split("/")
		.map((part) => part.trim())
		.filter(Boolean)
		.join("/");
}

function updateUrlPrefix(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		fail(`VETTA_UPDATE_URL 不是合法 URL：${value}`);
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		fail("VETTA_UPDATE_URL 必须使用 http 或 https");
	}
	if (url.username || url.password || url.search || url.hash) {
		fail("VETTA_UPDATE_URL 不能包含凭据、查询参数或 hash");
	}
	return decodeURIComponent(url.pathname)
		.split("/")
		.map((part) => part.trim())
		.filter(Boolean)
		.join("/");
}

function parseVersion(value, source) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
	if (!match) fail(`${source}版本号格式非法：${value}`);
	return match.slice(1).map(Number);
}

function isGreaterVersion(candidate, current) {
	const left = parseVersion(candidate, "目标");
	const right = parseVersion(current, "线上");
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) return left[index] > right[index];
	}
	return false;
}

function resolveInnoCompiler() {
	const candidates = [
		process.env.VETTA_INNO_SETUP_COMPILER?.trim(),
		process.env.LOCALAPPDATA
			? join(process.env.LOCALAPPDATA, "Programs", "Inno Setup 6", "ISCC.exe")
			: undefined,
		process.env.ProgramFiles ? join(process.env.ProgramFiles, "Inno Setup 6", "ISCC.exe") : undefined,
		process.env["ProgramFiles(x86)"]
			? join(process.env["ProgramFiles(x86)"], "Inno Setup 6", "ISCC.exe")
			: undefined,
	].filter(Boolean);
	const compiler = candidates.find((candidate) => existsSync(candidate));
	if (!compiler) fail("找不到 Inno Setup 6；请安装后重试，或设置 VETTA_INNO_SETUP_COMPILER");
	return compiler;
}

async function readOnlineVersion(updateUrl) {
	const metadataUrl = new URL(`${updateUrl.replace(/\/+$/, "")}/latest.yml`);
	metadataUrl.searchParams.set("release-windows-check", Date.now().toString());
	let response;
	try {
		response = await fetch(metadataUrl, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
	} catch (error) {
		fail(`无法读取线上 latest.yml：${error instanceof Error ? error.message : String(error)}`);
	}
	if (response.status === 404) return undefined;
	if (!response.ok) fail(`读取线上 latest.yml 失败：HTTP ${response.status}`);
	const metadata = await response.text();
	const version = /^version:\s*["']?(\d+\.\d+\.\d+)["']?\s*$/m.exec(metadata)?.[1];
	if (!version) fail("线上 latest.yml 缺少合法 version");
	return version;
}

function runBun(args, environment) {
	console.log(`$ bun ${args.join(" ")}`);
	execFileSync(bunExecutable, args, {
		cwd: repoRoot,
		env: environment,
		stdio: "inherit",
	});
}

async function findTextsInFile(filePath, texts) {
	const patterns = new Map(texts.map((text) => [text, Buffer.from(text)]));
	const found = new Set();
	const longestPattern = Math.max(...[...patterns.values()].map((pattern) => pattern.length));
	let carry = Buffer.alloc(0);
	for await (const chunk of createReadStream(filePath)) {
		const content = Buffer.concat([carry, chunk]);
		for (const [text, pattern] of patterns) {
			if (!found.has(text) && content.indexOf(pattern) >= 0) found.add(text);
		}
		carry = content.subarray(Math.max(0, content.length - longestPattern + 1));
	}
	return found;
}

async function verifyPackagedStableEnvironment(version) {
	const appAsarPath = join(releaseDir, "win-unpacked", "versions", version, "resources", "app.asar");
	if (!existsSync(appAsarPath)) fail(`找不到待校验的 app.asar：${appAsarPath}`);

	const expectedEnvironment = new Map(
		["VETTA_SERVER_URL", "VETTA_SITE_URL"].map((name) => [name, requireEnvironment(name)]),
	);
	const developmentEnvironmentPath = join(desktopDir, ".env.development");
	const developmentEnvironment = existsSync(developmentEnvironmentPath)
		? parseEnv(readFileSync(developmentEnvironmentPath))
		: {};
	const forbiddenEnvironment = new Map();
	for (const [name, expectedValue] of expectedEnvironment) {
		const developmentValue = developmentEnvironment[name]?.trim();
		if (developmentValue && developmentValue !== expectedValue) forbiddenEnvironment.set(name, developmentValue);
	}

	const values = [...new Set([...expectedEnvironment.values(), ...forbiddenEnvironment.values()])];
	const found = await findTextsInFile(appAsarPath, values);
	for (const [name, expectedValue] of expectedEnvironment) {
		if (!found.has(expectedValue)) fail(`最终 app.asar 未包含生产配置 ${name}=${expectedValue}`);
	}
	for (const [name, forbiddenValue] of forbiddenEnvironment) {
		if (found.has(forbiddenValue)) fail(`最终 app.asar 包含开发配置 ${name}=${forbiddenValue}`);
	}
	console.log(`[release-windows] packaged stable environment verified: ${appAsarPath}`);
}

async function confirmStableRelease(version) {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		fail("stable 发布需要交互确认；自动化环境请显式传入 --yes");
	}
	console.log("\n即将发布到 stable。请确认 test 已完成真实的旧版本更新闭环。");
	const readline = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const confirmation = await readline.question(`输入 ${version} 继续：`);
		if (confirmation.trim() !== version) fail("已取消");
	} finally {
		readline.close();
	}
}

async function printArtifacts() {
	const entries = await readdir(releaseDir, { withFileTypes: true });
	for (const entry of entries.filter((item) => item.isFile()).sort((left, right) => left.name.localeCompare(right.name))) {
		const size = (await stat(join(releaseDir, entry.name))).size;
		console.log(`    ${entry.name} (${(size / 1024 / 1024).toFixed(2)} MiB)`);
	}
}

async function main() {
	if (process.platform !== "win32") fail("Windows 发布脚本只能在 Windows 主机上运行");
	const options = parseArguments(process.argv.slice(2));
	const loadedFiles = loadEnvironment(options.channel);
	if (options.channel === "stable") enforceStableEnvironment();
	const desktopPackage = JSON.parse(readFileSync(desktopPackagePath, "utf8"));
	const packageVersion = desktopPackage.version;

	let version = options.version;
	if (options.channel === "stable") {
		if (version) fail(`stable 不接受 --version；正式版本以 package.json 为准（当前 ${packageVersion}）`);
		version = packageVersion;
	} else if (!version) {
		fail("test 必须显式指定 --version，避免复用或误发已有版本");
	}
	parseVersion(version, "目标");

	process.env.VETTA_UPDATE_PROVIDER = "generic";
	process.env.VETTA_BUILD_ENV = options.channel === "stable" ? "production" : "development";
	const updateUrl = requireEnvironment("VETTA_UPDATE_URL");
	const r2Prefix = normalizePrefix(requireEnvironment("VETTA_R2_PREFIX"));
	const urlPrefix = updateUrlPrefix(updateUrl);
	if (r2Prefix !== urlPrefix) {
		fail(`通道路径不一致：VETTA_R2_PREFIX=${r2Prefix}，VETTA_UPDATE_URL path=${urlPrefix}`);
	}
	if (r2Prefix.split("/").at(-1) !== options.channel) {
		fail(`VETTA_R2_PREFIX=${r2Prefix} 的末段不是 ${options.channel}`);
	}
	if (!options.skipPublish) {
		for (const name of [
			"VETTA_R2_ACCOUNT_ID",
			"VETTA_R2_ACCESS_KEY_ID",
			"VETTA_R2_SECRET_ACCESS_KEY",
			"VETTA_R2_BUCKET",
		]) {
			requireEnvironment(name);
		}
	}

	step("前置校验");
	const innoCompiler = resolveInnoCompiler();
	const onlineVersion = await readOnlineVersion(updateUrl);
	console.log(`    通道       ${options.channel} -> ${updateUrl}`);
	console.log(
		`    版本       ${version}${version !== packageVersion ? `（package.json 是 ${packageVersion}，QA 覆盖）` : ""}`,
	);
	console.log(`    构建环境   ${process.env.VETTA_BUILD_ENV}`);
	console.log(`    服务地址   ${process.env.VETTA_SERVER_URL}`);
	console.log(`    Inno       ${innoCompiler}`);
	console.log(`    线上版本   ${onlineVersion ?? "尚无 Windows 产物"}`);
	console.log(`    配置文件   ${loadedFiles.length > 0 ? loadedFiles.join("，") : "仅使用当前 Shell"}`);
	if (onlineVersion && !isGreaterVersion(version, onlineVersion)) {
		fail(`${version} 不高于 ${options.channel} 线上的 ${onlineVersion}；版本化对象禁止覆盖`);
	}

	if (options.checkOnly) {
		step("前置校验通过（--check-only，未清理 release/，未构建）");
		return;
	}
	if (options.channel === "stable" && !options.skipPublish && !options.assumeYes) {
		await confirmStableRelease(version);
	}

	const childEnvironment = { ...process.env };
	if (options.channel === "test") childEnvironment.VETTA_DESKTOP_BUILD_VERSION = version;
	else delete childEnvironment.VETTA_DESKTOP_BUILD_VERSION;

	step("清理 desktop-app/release/");
	await rm(releaseDir, { recursive: true, force: true });

	step(`构建 Windows Inno ${version}`);
	runBun(["run", "--cwd", "packages/desktop-app", "dist:win:inno"], childEnvironment);
	if (options.channel === "stable") {
		step("校验 stable 产物未混入开发环境地址");
		await verifyPackagedStableEnvironment(version);
	}

	step("校验 Windows 安装产物");
	runBun(["run", "--cwd", "packages/desktop-app", "verify:updates:windows"], childEnvironment);

	if (options.skipPublish) {
		step("已跳过 R2 发布（--skip-publish）");
		await printArtifacts();
		return;
	}

	step(`发布到 ${options.channel}：${updateUrl}`);
	runBun(["run", "--cwd", "packages/desktop-app", "publish:updates:r2"], childEnvironment);

	step(`完成：Windows ${version} 已发布到 ${options.channel}`);
	console.log("下一步：从更低版本安装包完成一次「检查 -> 差分下载 -> 更新并重启」闭环。");
}

await main();
