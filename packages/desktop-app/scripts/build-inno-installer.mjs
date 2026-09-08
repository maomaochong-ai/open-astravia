import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { pathToFileURL } from "node:url";
import { stringify } from "yaml";
import { buildWindowsLauncher } from "./windows-version-layout.mjs";

const require = createRequire(import.meta.url);
const { appBuilderPath } = require("app-builder-bin");
const projectRoot = join(import.meta.dirname, "..");
const buildStageDir = join(tmpdir(), "astravia-desktop-build");
const releaseDir = join(projectRoot, "release");
const installerScript = join(projectRoot, "build", "installer.iss");

function readOption(name) {
	const index = process.argv.indexOf(name);
	if (index < 0 || !process.argv[index + 1]) throw new Error(`[build-inno] missing ${name}`);
	return process.argv[index + 1];
}

export function resolveInnoCompiler(environment = process.env) {
	const configured = environment.ASTRAVIA_INNO_SETUP_COMPILER?.trim();
	const candidates = [
		configured,
		environment.LOCALAPPDATA
			? join(environment.LOCALAPPDATA, "Programs", "Inno Setup 6", "ISCC.exe")
			: undefined,
		environment.ProgramFiles ? join(environment.ProgramFiles, "Inno Setup 6", "ISCC.exe") : undefined,
		environment["ProgramFiles(x86)"]
			? join(environment["ProgramFiles(x86)"], "Inno Setup 6", "ISCC.exe")
			: undefined,
	].filter(Boolean);
	const compiler = candidates.find((candidate) => existsSync(candidate));
	if (compiler) return compiler;
	throw new Error(
		"[build-inno] Inno Setup 6 compiler not found. Install it or set ASTRAVIA_INNO_SETUP_COMPILER to ISCC.exe.",
	);
}

function unpackedDirectory(arch) {
	if (arch !== "x64") throw new Error(`[build-inno] unsupported Windows architecture: ${arch}`);
	return join(releaseDir, "win-unpacked");
}

export async function writeAppUpdateConfig(sourceDir, version, publishConfig) {
	const appUpdateConfigPath = join(sourceDir, "versions", version, "resources", "app-update.yml");
	if (publishConfig) {
		await writeFile(
			appUpdateConfigPath,
			stringify({ ...publishConfig, updaterCacheDirName: "astravia-updater" }),
			"utf8",
		);
		return;
	}
	await rm(appUpdateConfigPath, { force: true });
}

async function collectVerificationFiles(root, relativeRoot = "") {
	const files = [];
	for (const entry of await readdir(join(root, relativeRoot), { withFileTypes: true })) {
		const relativePath = join(relativeRoot, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectVerificationFiles(root, relativePath)));
		} else if (entry.isFile() && entry.name !== ".install-complete") {
			files.push({ path: relativePath.replaceAll("\\", "/"), size: (await stat(join(root, relativePath))).size });
		}
	}
	return files;
}

export async function writeInnoVerificationManifest(sourceVersionDir, manifestPath, version) {
	const files = await collectVerificationFiles(sourceVersionDir);
	files.sort((left, right) => left.path.localeCompare(right.path));
	await writeFile(manifestPath, `${JSON.stringify({ version, files }, null, 2)}\n`, "utf8");
}

async function main() {
	const arch = readOption("--arch");
	const sourceDir = unpackedDirectory(arch);
	const stagePackage = JSON.parse(await readFile(join(buildStageDir, "package.json"), "utf8"));
	const builderConfig = JSON.parse(await readFile(join(buildStageDir, "electron-builder.json"), "utf8"));
	const version = stagePackage.version;
	if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
		throw new Error(`[build-inno] invalid staged version: ${version}`);
	}
	if (!existsSync(join(sourceDir, "versions", version, "Astravia.exe"))) {
		throw new Error(`[build-inno] versioned Electron output not found: ${sourceDir}`);
	}

	const publishConfig = Array.isArray(builderConfig.publish) ? builderConfig.publish[0] : undefined;
	await writeAppUpdateConfig(sourceDir, version, publishConfig);
	if (publishConfig) {
		console.log(`[build-inno] wrote app-update.yml for ${publishConfig.provider}`);
	}
	const fileName = `Astravia-${version}-win-${arch}.exe`;
	const verificationManifestPath = join(releaseDir, `${fileName}.files.json`);
	await writeInnoVerificationManifest(join(sourceDir, "versions", version), verificationManifestPath, version);

	const compiler = resolveInnoCompiler();
	// MAX_PATH(260) 防护 ---------------------------------------------------
	// 版本化布局（versions\<v>\resources\...）叠加 vite 模块联邦超长 chunk
	// 文件名（实测后缀最坏 ~209 字符）后，ISCC 的 {#SourceDir} 前缀必须很短：
	//   CI 真实源路径前缀 ~65（D:\a\astravia\...）→ 完整路径 274 > 260，压缩到
	//   该文件时报 "The system cannot find the path specified."（无行号，I/O 错）；
	//   electron-builder 原生 %TEMP% junction 前缀 ~51 → ~260 仍贴边失败。
	// 这里把源目录 junction 到盘根级短目录（如 C:\avdXXXX\src，前缀 ~14），
	// 完整路径 ~223 留足余量。junction 可被 ISCC 正常递归（此前怀疑 junction
	// 导致图标加载失败系 MAX_PATH 误判，非 junction 机制问题）。
	let iscSourceDir = sourceDir;
	let shortLinkDir = null;
	{
		const roots = [...new Set([parse(sourceDir).root, parse(tmpdir()).root].filter(Boolean))];
		for (const root of roots) {
			const candidateDir = join(root, `avd${Math.random().toString(36).slice(2, 6)}`);
			try {
				await mkdir(candidateDir);
				const link = join(candidateDir, "src");
				await symlink(sourceDir, link, "junction");
				iscSourceDir = link;
				shortLinkDir = candidateDir;
				console.log(`[build-inno] MAX_PATH guard: ${sourceDir} junctioned -> ${link}`);
				break;
			} catch {
				// 该盘根不可写或 junction 创建失败，尝试下一个候选根
			}
		}
		if (!shortLinkDir) {
			console.warn(`[build-inno] 无法创建短路径 junction，ISCC 将使用原源目录（超长路径可能触发 MAX_PATH）: ${sourceDir}`);
		}
	}
	const versionedDir = join(sourceDir, "versions", version);
	// 把 installer.iss 引用的每个物理源路径在编译前逐条校验：ISCC 失败时只报
	// “The system cannot find the path specified.”（无行号/文件名），这里用
	// 明确信号定位到具体缺失文件。
	const requiredSources = [
		["root launcher (L57 ASTRAIVA.exe)", join(iscSourceDir, "ASTRAIVA.exe")],
		["root current.json (L58)", join(iscSourceDir, "current.json")],
		["versioned dir (L61 recursion root)", versionedDir],
		["resources\\app.asar", join(versionedDir, "resources", "app.asar")],
		["resources\\build\\icon.ico (SetupIconFile)", join(versionedDir, "resources", "build", "icon.ico")],
	];
	for (const [label, candidatePath] of requiredSources) {
		const present = existsSync(candidatePath);
		console.log(`[build-inno] ${present ? "PASS" : "MISSING"} ${label}: ${candidatePath}`);
	}
	const [launcherMissing] = requiredSources.filter(([, candidatePath]) => !existsSync(candidatePath));
	for (const missing of requiredSources.filter(([label, candidatePath]) => label !== launcherMissing?.[0] && !existsSync(candidatePath))) {
		throw new Error(`[build-inno] 编译前校验失败：${missing[0]} 不存在 —— ${missing[1]}`);
	}
	// root launcher 特例：electron-builder 会在 afterPack（layout）之后对 root
	// 主可执行文件再做一次签名/编辑，而 layout 已把 launcher 换到 root —— 该收尾
	// 步骤可能把 launcher 弄丢（无证书 CI 上实测 root ASTRAIVA.exe 消失）。
	// electron-builder 此时已退出，这里直接重编译 launcher 自愈（Go 小文件，秒级）。
	if (launcherMissing) {
		console.warn(`[build-inno] root launcher 缺失（${launcherMissing[1]}），重编译自愈 …`);
		buildWindowsLauncher({
			arch,
			outputPath: join(sourceDir, "Astravia.exe"),
			sourceDir: join(projectRoot, "native", "windows-launcher"),
		});
		if (!existsSync(join(sourceDir, "Astravia.exe"))) {
			throw new Error(`[build-inno] 重编译后 root launcher 仍不存在 —— ${join(sourceDir, "Astravia.exe")}`);
		}
		console.log("[build-inno] root launcher 重编译完成");
	}
	// 打印 versioned 目录与 resources 清单（各一层），供排查布局/打包完整性。
	for (const dirPath of [versionedDir, join(versionedDir, "resources")]) {
		const lines = [];
		for (const entry of await readdir(dirPath, { withFileTypes: true })) {
			const entryPath = join(dirPath, entry.name);
			const size = entry.isFile() ? (await stat(entryPath)).size : -1;
			lines.push(`    ${entry.isDirectory() ? "[D]" : "[F]"} ${entry.name}${size >= 0 ? ` (${size}B)` : ""}`);
		}
		console.log(`[build-inno] listing ${dirPath}:`);
		console.log(lines.join("\n") || "    (empty)");
	}
	let lastCompileError;
	for (let attempt = 1; attempt <= 2; attempt += 1) {
		try {
			execFileSync(
				compiler,
				[
					// 保留完整 ISCC 输出（不用 /Qp），编译失败时日志能指出正在处理的文件与行号。
					`/DAppVersion=${version}`,
					`/DSourceDir=${iscSourceDir}`,
					`/DOutputDir=${releaseDir}`,
					`/DArch=${arch}`,
					installerScript,
				],
				{ stdio: "inherit" },
			);
			lastCompileError = null;
			break;
		} catch (compileError) {
			lastCompileError = compileError;
			console.error(`[build-inno] ISCC attempt ${attempt}/2 failed.`);
			// 失败快照：抓输出 exe / app.asar / 磁盘空间，帮助区分写输出失败与源缺失。
			const snapshot = [];
			const snapshotCandidates = [
				["output exe", join(releaseDir, fileName)],
				["app.asar", join(sourceDir, "versions", version, "resources", "app.asar")],
				["root launcher", join(iscSourceDir, "ASTRAVIA.exe")],
			];
			for (const [label, candidatePath] of snapshotCandidates) {
				try {
					const info = statSync(candidatePath);
					snapshot.push(`  ${label}: PRESENT (${info.size}B)`);
				} catch {
					snapshot.push(`  ${label}: ABSENT`);
				}
			}
			try {
				const driveOutput = execFileSync("powershell", ["-NoProfile", "-Command", "Get-PSDrive -PSProvider FileSystem | Select-Object Name,@{n='FreeGB';e={[math]::Round($_.Free/1GB,1)}},@{n='UsedGB';e={[math]::Round($_.Used/1GB,1)}} | Format-Table -AutoSize"], { encoding: "utf8" });
				snapshot.push(`  disks:\n${driveOutput.trim()}`);
			} catch {
				// 磁盘快照失败不影响主流程
			}
			console.error(`[build-inno] snapshot after failed attempt ${attempt}:\n${snapshot.join("\n")}`);
			if (attempt === 1) {
				console.error("[build-inno] retrying ISCC once …");
				await new Promise((resolve) => setTimeout(resolve, 2000));
			}
		}
	}
	if (lastCompileError) throw lastCompileError;
	if (shortLinkDir) await rm(shortLinkDir, { recursive: true, force: true });

	const installerPath = join(releaseDir, fileName);
	if (!existsSync(installerPath)) throw new Error(`[build-inno] installer not found: ${installerPath}`);
	const blockmapPath = `${installerPath}.blockmap`;
	const blockmapOutput = execFileSync(
		appBuilderPath,
		["blockmap", `--input=${installerPath}`, `--output=${blockmapPath}`, "--compression=gzip"],
		{ encoding: "utf8" },
	).trim();
	const blockmapMetadata = JSON.parse(blockmapOutput);
	const installerStat = await stat(installerPath);
	if (blockmapMetadata.size !== installerStat.size || typeof blockmapMetadata.sha512 !== "string") {
		throw new Error("[build-inno] app-builder returned invalid installer metadata");
	}

	const metadata = {
		version,
		files: [
			{
				url: fileName,
				sha512: blockmapMetadata.sha512,
				size: installerStat.size,
			},
		],
		path: fileName,
		sha512: blockmapMetadata.sha512,
		releaseDate: new Date().toISOString(),
		...(typeof builderConfig.releaseInfo?.releaseNotes === "string"
			? { releaseNotes: builderConfig.releaseInfo.releaseNotes }
			: {}),
	};
	await writeFile(join(releaseDir, "latest.yml"), stringify(metadata), "utf8");
	console.log(`[build-inno] created ${fileName}, ${fileName}.blockmap, ${fileName}.files.json, latest.yml`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
