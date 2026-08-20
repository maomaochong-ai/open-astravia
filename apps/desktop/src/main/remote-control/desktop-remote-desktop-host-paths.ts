import { join } from "node:path";

export interface DesktopRemoteDesktopHostPaths {
	readonly preloadPath: string;
	readonly pagePath: string;
}

/**
 * Development runs from the workspace and keeps renderer output under dist/.
 * The pack staging directory copies those same outputs to its package root.
 */
export function resolveDesktopRemoteDesktopHostPaths(options: {
	readonly appRoot: string;
	readonly isPackaged: boolean;
}): DesktopRemoteDesktopHostPaths {
	const resourceRoot = options.isPackaged ? options.appRoot : join(options.appRoot, "dist");
	return {
		preloadPath: join(resourceRoot, "preload", "remote-desktop.js"),
		pagePath: join(resourceRoot, "renderer", "remote-desktop-host.html"),
	};
}
