import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseVettaNpmPluginPackage } from "@vetta-org/plugin-sdk/npm-package";
import npa from "npm-package-arg";
import { x as extractTar } from "tar";

const MAX_NPM_TARBALL_BYTES = 512 * 1024 * 1024;
const MAX_PLUGIN_ARCHIVE_BYTES = 512 * 1024 * 1024;
const REGISTRY_SPEC_TYPES = new Set(["tag", "version", "range"]);

export interface ResolvedNpmPluginArchive {
	archivePath: string;
	cleanup(): Promise<void>;
	expectedSha256: string;
	integrity?: string;
	packageManifest: NpmPluginPackageManifest;
	requestedSpec: string;
}

/** Public projection kept local so the bundled CLI has no published type dependency. */
export interface NpmPluginPackageManifest {
	name: string;
	version: string;
	vetta: {
		schemaVersion: 1;
		type: "desktop-plugin";
		pluginId: string;
		archive: string;
	};
}

export interface NpmPackResult {
	filename: string;
	integrity?: string;
}

export type NpmPackRunner = (packageSpec: string, destination: string) => Promise<NpmPackResult>;

function parsePackOutput(stdout: string): NpmPackResult {
	const parsed: unknown = JSON.parse(stdout);
	if (!Array.isArray(parsed) || parsed.length !== 1 || typeof parsed[0] !== "object" || parsed[0] === null) {
		throw new Error("npm pack returned an invalid JSON response");
	}
	const entry = parsed[0] as Record<string, unknown>;
	if (typeof entry.filename !== "string" || entry.filename.length === 0 || basename(entry.filename) !== entry.filename) {
		throw new Error("npm pack returned an invalid tarball filename");
	}
	return {
		filename: entry.filename,
		integrity: typeof entry.integrity === "string" ? entry.integrity : undefined,
	};
}

function npmInvocation(): { command: string; args: string[] } {
	const npmExecPath = process.env.npm_execpath;
	if (npmExecPath) {
		return { command: process.execPath, args: [npmExecPath] };
	}
	return { command: process.platform === "win32" ? "npm.cmd" : "npm", args: [] };
}

export const runNpmPack: NpmPackRunner = async (packageSpec, destination) => {
	const invocation = npmInvocation();
	const args = [
		...invocation.args,
		"pack",
		packageSpec,
		"--ignore-scripts",
		"--json",
		"--pack-destination",
		destination,
	];
	const output = await new Promise<string>((resolvePromise, rejectPromise) => {
		const child = spawn(invocation.command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.once("error", rejectPromise);
		child.once("exit", (code, signal) => {
			if (code === 0) resolvePromise(stdout);
			else rejectPromise(new Error(stderr.trim() || `npm pack failed (code=${code}, signal=${signal})`));
		});
	});
	return parsePackOutput(output);
};

function registryPackageName(packageSpec: string): string {
	const parsed = npa(packageSpec);
	if (!parsed.registry || !parsed.name || !REGISTRY_SPEC_TYPES.has(parsed.type)) {
		throw new Error("add accepts npm registry package names, tags, versions, or ranges");
	}
	return parsed.name;
}

function assertPathInside(root: string, candidate: string, label: string): void {
	const rel = relative(root, candidate);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`${label} escapes the temporary package root`);
}

async function extractRegularFile(tarballPath: string, destination: string, archivePath: string): Promise<string> {
	const tarPath = `package/${archivePath.replace(/\\/g, "/")}`;
	let matched = false;
	await extractTar({
		file: tarballPath,
		cwd: destination,
		strict: true,
		filter(path, entry) {
			if (path !== tarPath) return false;
			if (!("type" in entry) || entry.type !== "File") {
				throw new Error(`npm package entry must be a regular file: ${archivePath}`);
			}
			if (matched) throw new Error(`npm package entry is duplicated: ${archivePath}`);
			matched = true;
			return true;
		},
		strip: 1,
	});
	if (!matched) throw new Error(`npm package entry is missing: ${archivePath}`);
	const outputPath = resolve(destination, archivePath);
	assertPathInside(destination, outputPath, "npm package entry");
	const [resolvedRoot, resolvedOutput, info] = await Promise.all([realpath(destination), realpath(outputPath), stat(outputPath)]);
	assertPathInside(resolvedRoot, resolvedOutput, "npm package entry");
	if (!info.isFile()) throw new Error(`npm package entry must be a regular file: ${archivePath}`);
	return resolvedOutput;
}

export async function resolveNpmPluginArchive(
	packageSpec: string,
	pack: NpmPackRunner = runNpmPack,
): Promise<ResolvedNpmPluginArchive> {
	const requestedPackageName = registryPackageName(packageSpec);
	const temporaryRoot = await mkdtemp(join(tmpdir(), "vetta-plugin-add-"));
	const cleanup = () => rm(temporaryRoot, { recursive: true, force: true });
	try {
		const packed = await pack(packageSpec, temporaryRoot);
		const tarballPath = resolve(temporaryRoot, packed.filename);
		assertPathInside(temporaryRoot, tarballPath, "npm tarball");
		const tarballInfo = await stat(tarballPath);
		if (!tarballInfo.isFile() || tarballInfo.size > MAX_NPM_TARBALL_BYTES) {
			throw new Error("npm plugin package tarball is missing or exceeds the 512 MB limit");
		}

		const packageJsonPath = await extractRegularFile(tarballPath, temporaryRoot, "package.json");
		const packageManifest = parseVettaNpmPluginPackage(JSON.parse(await readFile(packageJsonPath, "utf8")) as unknown);
		if (packageManifest.name !== requestedPackageName) {
			throw new Error(
				`npm package name mismatch: requested ${requestedPackageName}, received ${packageManifest.name}`,
			);
		}
		const archivePath = await extractRegularFile(tarballPath, temporaryRoot, packageManifest.vetta.archive);
		const archive = await readFile(archivePath);
		if (archive.length > MAX_PLUGIN_ARCHIVE_BYTES) {
			throw new Error("Vetta plugin archive exceeds the 512 MB limit");
		}

		return {
			archivePath,
			cleanup,
			expectedSha256: createHash("sha256").update(archive).digest("hex"),
			integrity: packed.integrity,
			packageManifest,
			requestedSpec: packageSpec,
		};
	} catch (error) {
		await cleanup();
		throw error;
	}
}
