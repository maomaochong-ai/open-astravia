import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { stringify } from "yaml";

const require = createRequire(import.meta.url);
const { appBuilderPath } = require("app-builder-bin");
const projectRoot = join(import.meta.dirname, "..");
const buildStageDir = join(tmpdir(), "vetta-desktop-build");
const releaseDir = join(projectRoot, "release");
const installerScript = join(projectRoot, "build", "installer.iss");

function readOption(name) {
	const index = process.argv.indexOf(name);
	if (index < 0 || !process.argv[index + 1]) throw new Error(`[build-inno] missing ${name}`);
	return process.argv[index + 1];
}

export function resolveInnoCompiler(environment = process.env) {
	const configured = environment.VETTA_INNO_SETUP_COMPILER?.trim();
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
		"[build-inno] Inno Setup 6 compiler not found. Install it or set VETTA_INNO_SETUP_COMPILER to ISCC.exe.",
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
			stringify({ ...publishConfig, updaterCacheDirName: "vetta-updater" }),
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
	if (!existsSync(join(sourceDir, "versions", version, "Vetta.exe"))) {
		throw new Error(`[build-inno] versioned Electron output not found: ${sourceDir}`);
	}

	const publishConfig = Array.isArray(builderConfig.publish) ? builderConfig.publish[0] : undefined;
	await writeAppUpdateConfig(sourceDir, version, publishConfig);
	if (publishConfig) {
		console.log(`[build-inno] wrote app-update.yml for ${publishConfig.provider}`);
	}
	const fileName = `Vetta-${version}-win-${arch}.exe`;
	const verificationManifestPath = join(releaseDir, `${fileName}.files.json`);
	await writeInnoVerificationManifest(join(sourceDir, "versions", version), verificationManifestPath, version);

	const compiler = resolveInnoCompiler();
	const compilerWorkDir = await mkdtemp(join(tmpdir(), "vi-"));
	const shortSourceDir = join(compilerWorkDir, "src");
	await symlink(sourceDir, shortSourceDir, "junction");
	try {
		execFileSync(
			compiler,
			[
				"/Qp",
				`/DAppVersion=${version}`,
				`/DSourceDir=${shortSourceDir}`,
				`/DOutputDir=${releaseDir}`,
				`/DArch=${arch}`,
				installerScript,
			],
			{ stdio: "inherit" },
		);
	} finally {
		await rm(compilerWorkDir, { recursive: true, force: true });
	}

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
