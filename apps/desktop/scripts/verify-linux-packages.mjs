import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parse } from "yaml";

const execFileAsync = promisify(execFile);
const packageDir = resolve(import.meta.dirname, "..");
const defaultReleaseDir = join(packageDir, "release");
const requiredPayloadPaths = ["/opt/Vetta/Vetta", "/opt/Vetta/resources/package-type"];

function requireValue(value, label) {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`[verify-linux-packages] missing ${label}`);
	}
	return value.trim();
}

export function parseDebFields(output) {
	const fields = new Map();
	for (const line of output.split(/\r?\n/)) {
		const separator = line.indexOf(":");
		if (separator <= 0) continue;
		fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
	}
	return {
		name: requireValue(fields.get("Package"), "Debian Package field"),
		version: requireValue(fields.get("Version"), "Debian Version field"),
		arch: requireValue(fields.get("Architecture"), "Debian Architecture field"),
	};
}

export function parseDebContents(output) {
	return output
		.split(/\r?\n/)
		.map((line) => line.match(/\s(\.\/\S+?)(?:\s+->\s+\S+)?$/)?.[1])
		.filter(Boolean)
		.map((filePath) => filePath.replace(/^\./, ""));
}

export function parseRpmFields(output) {
	const [name, version, arch] = output.split(/\r?\n/).map((value) => value.trim());
	return {
		name: requireValue(name, "RPM name"),
		version: requireValue(version, "RPM version"),
		arch: requireValue(arch, "RPM architecture"),
	};
}

function verifyPayload(format, paths) {
	const pathSet = new Set(paths);
	for (const requiredPath of requiredPayloadPaths) {
		if (!pathSet.has(requiredPath)) {
			throw new Error(`[verify-linux-packages] ${format} package is missing ${requiredPath}`);
		}
	}
	if (![...pathSet].some((filePath) => /^\/usr\/share\/applications\/[^/]+\.desktop$/.test(filePath))) {
		throw new Error(`[verify-linux-packages] ${format} package has no desktop entry`);
	}
	if (![...pathSet].some((filePath) => filePath.startsWith("/usr/share/icons/hicolor/") && filePath.endsWith(".png"))) {
		throw new Error(`[verify-linux-packages] ${format} package has no hicolor icon`);
	}
}

function verifyIdentity(format, actual, expected) {
	for (const key of ["name", "version", "arch"]) {
		if (actual[key] !== expected[key]) {
			throw new Error(
				`[verify-linux-packages] ${format} ${key} ${actual[key]} does not match ${expected[key]}`,
			);
		}
	}
}

export function verifyLinuxPackageInspection({ expectedVersion, deb, rpm }) {
	verifyIdentity("Debian", deb, { name: "vetta", version: expectedVersion, arch: "amd64" });
	verifyIdentity("RPM", rpm, { name: "vetta", version: expectedVersion, arch: "x86_64" });
	verifyPayload("Debian", deb.paths);
	verifyPayload("RPM", rpm.paths);
}

async function findExactlyOnePackage(releaseDir, extension) {
	const files = (await readdir(releaseDir, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension))
		.map((entry) => entry.name)
		.sort();
	if (files.length !== 1) {
		throw new Error(
			`[verify-linux-packages] expected one ${extension} package in ${releaseDir}, found ${files.length}`,
		);
	}
	return join(releaseDir, files[0]);
}

export async function readExpectedVersion(releaseDir) {
	const metadataFiles = (await readdir(releaseDir, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && /^latest-linux(?:-[a-z0-9_-]+)?\.ya?ml$/i.test(entry.name))
		.map((entry) => entry.name);
	if (metadataFiles.length !== 1) {
		throw new Error(
			`[verify-linux-packages] expected one Linux update manifest in ${releaseDir}, found ${metadataFiles.length}`,
		);
	}
	const document = parse(await readFile(join(releaseDir, metadataFiles[0]), "utf8"));
	if (typeof document?.version !== "string" || !/^\d+\.\d+\.\d+$/.test(document.version)) {
		throw new Error(`[verify-linux-packages] ${metadataFiles[0]} has an invalid version`);
	}
	return document.version;
}

export async function verifyLinuxPackages({ releaseDir = defaultReleaseDir } = {}) {
	if (process.platform !== "linux") {
		throw new Error("[verify-linux-packages] native Linux package verification must run on Linux");
	}
	const [expectedVersion, debPath, rpmPath] = await Promise.all([
		readExpectedVersion(releaseDir),
		findExactlyOnePackage(releaseDir, ".deb"),
		findExactlyOnePackage(releaseDir, ".rpm"),
	]);
	const [debFields, debContents, rpmFields, rpmContents] = await Promise.all([
		execFileAsync("dpkg-deb", ["--field", debPath]),
		execFileAsync("dpkg-deb", ["--contents", debPath]),
		execFileAsync("rpm", ["-qp", "--queryformat", "%{NAME}\\n%{VERSION}\\n%{ARCH}\\n", rpmPath]),
		execFileAsync("rpm", ["-qlp", rpmPath]),
	]);
	const inspection = {
		deb: {
			...parseDebFields(debFields.stdout),
			paths: parseDebContents(debContents.stdout),
		},
		rpm: {
			...parseRpmFields(rpmFields.stdout),
			paths: rpmContents.stdout.split(/\r?\n/).filter(Boolean),
		},
	};
	verifyLinuxPackageInspection({ expectedVersion, ...inspection });
	console.info(`[verify-linux-packages] Debian and RPM packages verified: ${expectedVersion}`);
	return { version: expectedVersion, ...inspection };
}

export async function main() {
	await verifyLinuxPackages();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
