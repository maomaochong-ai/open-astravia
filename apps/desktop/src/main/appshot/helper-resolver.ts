import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

const APP_BUNDLE_NAME = "Vetta Computer Use.app";
const EXECUTABLE_NAME = "Vetta Computer Use";

/**
 * Resolve the absolute path to the `Vetta Computer Use.app` bundle (macOS only).
 *
 * In packaged builds the bundle lives under
 *   <Resources>/appshot/Vetta Computer Use.app
 * (staged by scripts/prepare-pack.js via extraResources).
 *
 * In dev mode (`!app.isPackaged`) we fall back to
 *   <apps/desktop>/resources/appshot/bin/Vetta Computer Use.app
 * which scripts/build-appshot-helper.js compiles as part of `bun run dev`.
 * We resolve relative to `process.cwd()`, which is `apps/desktop`
 * when running via `bun run dev` (same trick as im-host/binary-resolver.ts;
 * `app.getAppPath()` is unreliable in dev mode).
 */
export function resolveHelperAppBundlePath(): string {
	return app.isPackaged
		? join(process.resourcesPath, "appshot", APP_BUNDLE_NAME)
		: join(process.cwd(), "resources", "appshot", "bin", APP_BUNDLE_NAME);
}

/**
 * Resolve the absolute path to the helper's Mach-O executable inside
 * `Vetta Computer Use.app`.
 *
 * Throws if the resolved path does not exist on disk so the caller can
 * surface a precise error instead of failing later in spawn.
 */
export function resolveAppshotHelperBinary(): string {
	const fullPath = join(resolveHelperAppBundlePath(), "Contents", "MacOS", EXECUTABLE_NAME);

	if (!existsSync(fullPath)) {
		throw new Error(
			`appshot helper binary not found at ${fullPath}. ` +
				`Run 'node scripts/build-appshot-helper.js' in apps/desktop, or rebuild Vetta.app.`,
		);
	}

	return fullPath;
}

/** 已成功清理过 quarantine 的 bundle 路径集合，避免每次 spawn 前都同步阻塞主进程重复调用 xattr。 */
const quarantineClearedPaths = new Set<string>();

/**
 * Clear the macOS quarantine attribute on the helper .app bundle so it can be
 * launched (and dragged into System Settings for TCC authorization) without
 * a Gatekeeper prompt. Idempotent — `xattr -dr` on a bundle without the
 * attribute is a harmless no-op. Best-effort: failures are logged only, never
 * thrown, since a stale quarantine flag should not block capture attempts.
 *
 * Caches success per bundle path for the lifetime of the process: once cleared,
 * later calls are no-ops instead of re-running the synchronous `xattr` child
 * process (which blocks the Electron main event loop) on every capture/permission
 * check. A rebuilt bundle at the same path re-quarantined by Gatekeeper is an
 * edge case handled by restarting the app (fresh cache).
 */
export function clearHelperQuarantine(): void {
	const appBundlePath = resolveHelperAppBundlePath();
	if (quarantineClearedPaths.has(appBundlePath)) return;
	if (!existsSync(appBundlePath)) return;
	try {
		execFileSync("xattr", ["-dr", "com.apple.quarantine", appBundlePath]);
		quarantineClearedPaths.add(appBundlePath);
	} catch (error) {
		console.warn(`[appshot] failed to clear quarantine on ${appBundlePath}:`, error);
	}
}
