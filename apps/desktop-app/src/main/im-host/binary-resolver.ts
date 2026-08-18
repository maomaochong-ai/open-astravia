import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

/**
 * Resolve the absolute path to the im-gateway sidecar binary for the
 * current platform/arch.
 *
 * In packaged builds the binary lives under
 *   <Resources>/im-gateway/im-gateway-<os>-<arch>[.exe]
 *
 * In dev mode (`!app.isPackaged`) we fall back to
 *   <packages>/im-gateway/dist/im-gateway-<os>-<arch>[.exe]
 *
 * The dev path assumes you've run `make cross-build` inside
 * apps/im-gateway/. We resolve relative to `process.cwd()`, which is
 * `apps/desktop-app` when running via `bun run dev` (the same trick
 * main.ts uses to compute appRoot in dev mode). Going one level up lands
 * in `packages/`. Note: `app.getAppPath()` is unreliable in dev mode
 * because Electron treats the entry script's directory (dist/main) as
 * the app dir, not the directory containing package.json.
 *
 * Throws if the resolved path does not exist on disk so the caller can
 * surface a precise error to the user instead of failing later in spawn.
 */
export interface ResolvedBinary {
	path: string;
	platform: NodeJS.Platform;
	arch: string;
}

/**
 * Map Node's process.arch to the value Go uses in GOARCH. Currently the
 * only divergence we care about is "x64" → "amd64".
 */
function nodeArchToGoArch(arch: string): string {
	if (arch === "x64") return "amd64";
	return arch; // arm64, etc.
}

/**
 * Map Node's process.platform to GOOS string used in our binary names.
 */
function nodePlatformToGoOS(platform: NodeJS.Platform): string {
	if (platform === "win32") return "windows";
	return platform; // darwin, linux
}

export function resolveImGatewayBinary(): ResolvedBinary {
	const platform = process.platform;
	const arch = process.arch;
	const goOS = nodePlatformToGoOS(platform);
	const goArch = nodeArchToGoArch(arch);
	const ext = platform === "win32" ? ".exe" : "";
	const fileName = `im-gateway-${goOS}-${goArch}${ext}`;

	let basePath: string;
	if (app.isPackaged) {
		basePath = join(process.resourcesPath, "im-gateway");
	} else {
		// Dev mode: process.cwd() is apps/desktop-app when launched
		// via `bun run dev`. Sibling im-gateway holds our dist/.
		basePath = join(process.cwd(), "..", "im-gateway", "dist");
	}

	const fullPath = join(basePath, fileName);

	if (!existsSync(fullPath)) {
		throw new Error(
			`im-gateway sidecar binary not found at ${fullPath}. ` +
				`Run 'make cross-build' in apps/im-gateway, or rebuild Vetta.app.`,
		);
	}

	return { path: fullPath, platform, arch };
}
