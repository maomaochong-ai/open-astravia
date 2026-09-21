import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import AdmZip from "adm-zip";

export const VENDOR_CACHE_DIR = join(tmpdir(), "vetta-desktop-vendor-cache");
const manifestPath = join(import.meta.dirname, "../src/main/runtimes/manifest.json");

function readableArchive(path, filename) {
	if (!existsSync(path)) return false;
	try {
		// GNU tar (Linux and Git Bash) cannot read the Windows Node ZIP.
		if (filename.endsWith(".zip")) return new AdmZip(path).test();
		// A drive-letter archive argument is interpreted as a remote host by GNU tar.
		execFileSync("tar", ["-tf", basename(path)], { cwd: dirname(path), stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

export async function prepareVendorRuntimes({
	platformTag = process.env.VETTA_VENDOR_PLATFORM || `${process.platform}-${process.arch}`,
	manifest = JSON.parse(readFileSync(manifestPath, "utf8")),
	cacheDir = VENDOR_CACHE_DIR,
	fetchImpl = fetch,
	log = console.log,
} = {}) {
	if (!/^(darwin|linux|win32)-(arm64|x64)$/.test(platformTag)) {
		throw new Error(`Unsupported vendor platform: ${platformTag}`);
	}
	const archives = [];
	for (const type of ["node", "python"]) {
		const def = manifest[type];
		const entry = def?.platforms?.[platformTag];
		if (
			!entry ||
			typeof entry.filename !== "string" ||
			!entry.filename ||
			basename(entry.filename) !== entry.filename ||
			/[\\/:]/.test(entry.filename) ||
			entry.filename === "." ||
			entry.filename === ".."
		) {
			throw new Error(`Invalid vendor manifest entry for ${type} (${platformTag})`);
		}
		const archivePath = join(cacheDir, platformTag, type, entry.filename);
		await mkdir(join(cacheDir, platformTag, type), { recursive: true });
		let ready = readableArchive(archivePath, entry.filename);
		if (ready) log(`[vendor] cached: ${type} (${platformTag})`);
		else await rm(archivePath, { force: true });
		for (const template of def.sources) {
			if (ready) break;
			const url = template
				.replace("{version}", def.version)
				.replace("{release}", def.release ?? "")
				.replace("{filename}", entry.filename);
			const partial = `${archivePath}.${process.pid}.part`;
			try {
				log(`[vendor] downloading ${type}: ${url}`);
				const response = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(300_000) });
				if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
				await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
				if (!readableArchive(partial, entry.filename)) throw new Error("Invalid runtime archive");
				await rename(partial, archivePath);
				ready = true;
			} catch (error) {
				log(`[vendor] download failed: ${error.message}`);
			} finally {
				await rm(partial, { force: true });
			}
		}
		if (!ready) throw new Error(`Cannot download vendor ${type} (${platformTag})`);
		archives.push({ type, def, entry, archivePath });
	}
	return archives;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	prepareVendorRuntimes().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
