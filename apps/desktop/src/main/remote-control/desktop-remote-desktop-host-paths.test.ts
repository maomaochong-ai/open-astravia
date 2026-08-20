import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDesktopRemoteDesktopHostPaths } from "./desktop-remote-desktop-host-paths.js";

describe("resolveDesktopRemoteDesktopHostPaths", () => {
	it("uses the packaged staging root", () => {
		expect(resolveDesktopRemoteDesktopHostPaths({ appRoot: "C:/app.asar", isPackaged: true })).toEqual({
			preloadPath: join("C:/app.asar", "preload", "remote-desktop.js"),
			pagePath: join("C:/app.asar", "renderer", "remote-desktop-host.html"),
		});
	});

	it("uses dist for development", () => {
		expect(
			resolveDesktopRemoteDesktopHostPaths({ appRoot: "C:/open-vetta/apps/desktop", isPackaged: false }),
		).toEqual({
			preloadPath: join("C:/open-vetta/apps/desktop", "dist", "preload", "remote-desktop.js"),
			pagePath: join("C:/open-vetta/apps/desktop", "dist", "renderer", "remote-desktop-host.html"),
		});
	});
});
