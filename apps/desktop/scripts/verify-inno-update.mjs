import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

const projectRoot = join(import.meta.dirname, "..");
const releaseDir = join(projectRoot, "release");

async function assertFile(path) {
	const info = await stat(path);
	if (!info.isFile()) throw new Error(`Expected file: ${path}`);
}

async function collectFileSizes(root, relativeRoot = "") {
	const files = new Map();
	for (const entry of await readdir(join(root, relativeRoot), { withFileTypes: true })) {
		const relativePath = join(relativeRoot, entry.name);
		if (entry.isDirectory()) {
			for (const [path, size] of await collectFileSizes(root, relativePath)) files.set(path, size);
		} else if (entry.isFile() && entry.name !== ".install-complete") {
			files.set(relativePath.replaceAll("\\", "/"), (await stat(join(root, relativePath))).size);
		}
	}
	return files;
}

async function runInstaller(installerPath, storeRoot, version) {
	const progressPath = join(storeRoot, "progress");
	const logPath = join(storeRoot, "install.log");
	const args = [
		"/VERYSILENT",
		"/SUPPRESSMSGBOXES",
		"/NORESTART",
		"/NOCLOSEAPPLICATIONS",
		"/NORESTARTAPPLICATIONS",
		"/SP-",
		"/VETTAUPDATE=true",
		`/VETTASTOREROOT=${storeRoot}`,
		`/VETTAPROGRESS=${progressPath}`,
		`/LOG=${logPath}`,
	];
	await new Promise((resolve, reject) => {
		const child = spawn(installerPath, args, { detached: true, stdio: "ignore", windowsHide: true });
		child.unref();
		const keepAlive = setInterval(() => {}, 250);
		child.once("error", (error) => {
			clearInterval(keepAlive);
			reject(error);
		});
		child.once("close", (code) => {
			clearInterval(keepAlive);
			if (code === 0) resolve();
			else reject(new Error(`Inno Setup exited with code ${code ?? "unknown"}; log: ${logPath}`));
		});
	});
	return logPath;
}

export async function verifyInnoUpdate({ installerPath, verificationManifestPath, version, localAppData }) {
	if (process.platform !== "win32") {
		throw new Error("[verify-inno-update] Windows is required to verify an Inno Setup artifact");
	}
	if (!localAppData) throw new Error("[verify-inno-update] LOCALAPPDATA is unavailable");
	const storeRoot = await mkdtemp(join(localAppData, "V"));
	const installedVersionDir = join(storeRoot, "versions", version);
	try {
		await runInstaller(installerPath, storeRoot, version);
		await Promise.all([
			assertFile(join(installedVersionDir, "Vetta.exe")),
			assertFile(join(installedVersionDir, "resources", "app.asar")),
			assertFile(join(installedVersionDir, ".install-complete")),
		]);
		const markerVersion = await readFile(join(installedVersionDir, ".install-complete"), "utf8");
		if (markerVersion !== version) {
			throw new Error(`[verify-inno-update] completion marker is ${markerVersion}, expected ${version}`);
		}
		const verificationManifest = JSON.parse(await readFile(verificationManifestPath, "utf8"));
		if (verificationManifest?.version !== version || !Array.isArray(verificationManifest.files)) {
			throw new Error("[verify-inno-update] verification manifest is invalid");
		}
		const expectedFiles = new Map();
		for (const file of verificationManifest.files) {
			if (typeof file?.path !== "string" || typeof file?.size !== "number" || expectedFiles.has(file.path)) {
				throw new Error("[verify-inno-update] verification manifest contains an invalid file");
			}
			expectedFiles.set(file.path, file.size);
		}
		const installedFiles = await collectFileSizes(installedVersionDir);
		if (expectedFiles.size !== installedFiles.size) {
			throw new Error(
				`[verify-inno-update] installed file count ${installedFiles.size} does not match manifest ${expectedFiles.size}`,
			);
		}
		for (const [relativePath, size] of expectedFiles) {
			if (installedFiles.get(relativePath) !== size) {
				throw new Error(`[verify-inno-update] installed file differs: ${relativePath}`);
			}
		}
		console.log(`[verify-inno-update] verified ${version}: ${expectedFiles.size} files`);
	} finally {
		await rm(storeRoot, { recursive: true, force: true });
	}
}

function referencedInstaller(document) {
	const references = [
		document?.path,
		...(Array.isArray(document?.files) ? document.files.map((file) => file?.url) : []),
	];
	for (const reference of references) {
		if (typeof reference !== "string") continue;
		const fileName = basename(decodeURIComponent(reference.split(/[?#]/, 1)[0].replaceAll("\\", "/")));
		if (fileName.toLowerCase().endsWith(".exe")) return fileName;
	}
	return undefined;
}

export async function main() {
	const document = parse(await readFile(join(releaseDir, "latest.yml"), "utf8"));
	if (typeof document?.version !== "string" || !/^\d+\.\d+\.\d+$/.test(document.version)) {
		throw new Error("[verify-inno-update] latest.yml has an invalid version");
	}
	const installerFileName = referencedInstaller(document);
	if (!installerFileName) {
		console.log("[verify-inno-update] no Windows installer referenced; skipped");
		return;
	}
	await verifyInnoUpdate({
		installerPath: join(releaseDir, installerFileName),
		verificationManifestPath: join(releaseDir, `${installerFileName}.files.json`),
		version: document.version,
		localAppData: process.env.LOCALAPPDATA,
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
