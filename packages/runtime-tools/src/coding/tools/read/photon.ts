import type * as NodeFs from "node:fs";
import type { PathOrFileDescriptor } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type * as PhotonNode from "@silvia-odwyer/photon-node";

const require = createRequire(import.meta.url);
const fs = require("node:fs") as typeof NodeFs;
const WASM_FILENAME = "photon_rs_bg.wasm";

type PhotonModule = typeof PhotonNode;
type ReadFileSync = typeof fs.readFileSync;

let photonModule: PhotonModule | null = null;
let loadPromise: Promise<PhotonModule | null> | null = null;

function pathOrNull(file: PathOrFileDescriptor): string | null {
	if (typeof file === "string") {
		return file;
	}
	if (file instanceof URL) {
		return fileURLToPath(file);
	}
	return null;
}

function getFallbackWasmPaths(): string[] {
	const executableDirectory = dirname(process.execPath);
	return [
		join(executableDirectory, WASM_FILENAME),
		join(executableDirectory, "photon", WASM_FILENAME),
		join(process.cwd(), WASM_FILENAME),
	];
}

function patchPhotonWasmRead(): () => void {
	const originalReadFileSync: ReadFileSync = fs.readFileSync.bind(fs);
	const fallbackPaths = getFallbackWasmPaths();
	const mutableFs = fs as { readFileSync: ReadFileSync };

	const patchedReadFileSync: ReadFileSync = ((...args: Parameters<ReadFileSync>) => {
		const [file, options] = args;
		const resolvedPath = pathOrNull(file);

		if (resolvedPath?.endsWith(WASM_FILENAME)) {
			try {
				return originalReadFileSync(...args);
			} catch (error) {
				const fileError = error as NodeJS.ErrnoException;
				if (fileError.code && fileError.code !== "ENOENT") {
					throw error;
				}

				for (const fallbackPath of fallbackPaths) {
					if (!fs.existsSync(fallbackPath)) {
						continue;
					}
					if (options === undefined) {
						return originalReadFileSync(fallbackPath);
					}
					return originalReadFileSync(fallbackPath, options);
				}
				throw error;
			}
		}

		return originalReadFileSync(...args);
	}) as ReadFileSync;

	try {
		mutableFs.readFileSync = patchedReadFileSync;
	} catch {
		Object.defineProperty(fs, "readFileSync", {
			value: patchedReadFileSync,
			writable: true,
			configurable: true,
		});
	}

	return () => {
		try {
			mutableFs.readFileSync = originalReadFileSync;
		} catch {
			Object.defineProperty(fs, "readFileSync", {
				value: originalReadFileSync,
				writable: true,
				configurable: true,
			});
		}
	};
}

export async function loadPhoton(): Promise<PhotonModule | null> {
	if (photonModule) {
		return photonModule;
	}
	if (loadPromise) {
		return loadPromise;
	}

	loadPromise = (async () => {
		const restoreReadFileSync = patchPhotonWasmRead();
		try {
			const required = require("@silvia-odwyer/photon-node") as PhotonModule;
			photonModule = required;
			return photonModule;
		} catch (error) {
			console.warn(
				"[image-resize] Photon WASM failed to load — images that require resizing will be omitted. " +
					`Tried fallback paths: ${getFallbackWasmPaths().join(", ")}. Error: ${error instanceof Error ? error.message : String(error)}`,
			);
			photonModule = null;
			return photonModule;
		} finally {
			restoreReadFileSync();
		}
	})();

	return loadPromise;
}
