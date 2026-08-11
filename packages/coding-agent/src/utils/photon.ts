/**
 * Photon image processing wrapper.
 *
 * This module provides a unified interface to @silvia-odwyer/photon-node that works in:
 * 1. Node.js (development, npm run build)
 * 2. Bun compiled binaries (standalone distribution)
 *
 * The challenge: photon-node's CJS entry uses fs.readFileSync(__dirname + '/photon_rs_bg.wasm')
 * which bakes the build machine's absolute path into Bun compiled binaries.
 *
 * Solution:
 * 1. Patch fs.readFileSync to redirect missing photon_rs_bg.wasm reads
 * 2. Use an embedded WASM path in standalone binaries, or a sidecar file in legacy builds
 */

import type * as PhotonNode from "@silvia-odwyer/photon-node";
import type { PathOrFileDescriptor } from "fs";
import { createRequire } from "module";
import * as path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const fs = require("fs") as typeof import("fs");

// Re-export types from the main package
export type { PhotonImage as PhotonImageType } from "@silvia-odwyer/photon-node";

type ReadFileSync = typeof fs.readFileSync;
type PhotonModule = typeof PhotonNode;

const WASM_FILENAME = "photon_rs_bg.wasm";
let embeddedWasmPath: string | undefined;
let embeddedPhotonLoader: (() => Promise<unknown>) | undefined;

// Lazy-loaded photon module
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
	const execDir = path.dirname(process.execPath);
	return [
		...(embeddedWasmPath ? [embeddedWasmPath] : []),
		path.join(execDir, WASM_FILENAME),
		path.join(execDir, "photon", WASM_FILENAME),
		path.join(process.cwd(), WASM_FILENAME),
	];
}

/** Install the Bun-embedded Photon asset path before the first image operation. */
export function installPhotonWasmPath(wasmPath: string): void {
	embeddedWasmPath = wasmPath;
}

/** Install a compile-time-visible loader so standalone binaries include the Photon module. */
export function installPhotonModuleLoader(loader: () => Promise<unknown>): void {
	embeddedPhotonLoader = loader;
}

function normalizePhotonModule(value: unknown): PhotonModule {
	const candidate =
		typeof value === "object" && value !== null && Reflect.get(value, "default")
			? Reflect.get(value, "default")
			: value;
	return candidate as PhotonModule;
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
				const err = error as NodeJS.ErrnoException;
				if (err?.code && err.code !== "ENOENT") {
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

/**
 * Load the photon module asynchronously.
 * Returns cached module on subsequent calls.
 */
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
			// Use CJS require: photon-node ships as CommonJS using __dirname to
			// locate its WASM. Dynamic `import()` of CJS through ESM can produce
			// `{ default: ... }` wrapping and triggers __dirname-undefined errors
			// when bundlers inline the package into an ESM host (e.g., Vite main
			// build with "type":"module"). require keeps CJS semantics and
			// resolves the package's own package.json (CJS by default).
			const required = embeddedPhotonLoader
				? normalizePhotonModule(await embeddedPhotonLoader())
				: (require("@silvia-odwyer/photon-node") as PhotonModule);
			photonModule = required;
			return photonModule;
		} catch (err) {
			console.warn(
				"[image-resize] Photon WASM failed to load — images that require resizing will be omitted. " +
					`Tried fallback paths: ${getFallbackWasmPaths().join(", ")}. Error: ${err instanceof Error ? err.message : String(err)}`,
			);
			photonModule = null;
			return photonModule;
		} finally {
			restoreReadFileSync();
		}
	})();

	return loadPromise;
}
