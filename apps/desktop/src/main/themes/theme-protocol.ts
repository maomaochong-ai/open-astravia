import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { type CustomScheme, protocol } from "electron";
import type { DesktopThemePackageSource } from "../../preload/api-types/themes.js";
import { resolveThemeFilePath } from "./theme-store.js";

function contentType(path: string): string {
	switch (extname(path).toLowerCase()) {
		case ".js":
		case ".mjs":
			return "text/javascript; charset=utf-8";
		case ".css":
			return "text/css; charset=utf-8";
		case ".json":
			return "application/json; charset=utf-8";
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		default:
			return "application/octet-stream";
	}
}

export const THEME_PROTOCOL_PRIVILEGE: CustomScheme = {
	scheme: "vetta-theme",
	privileges: {
		standard: true,
		secure: true,
		supportFetchAPI: true,
		corsEnabled: true,
	},
};

export function registerThemeProtocol(): void {
	protocol.handle("vetta-theme", async (request) => {
		const url = new URL(request.url);
		const separatorIndex = url.hostname.indexOf("--");
		const source = url.hostname.slice(0, separatorIndex);
		const themeId = url.hostname.slice(separatorIndex + 2);
		if (source !== "builtin" && source !== "remote") {
			return new Response("Invalid theme source", { status: 400 });
		}
		const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
		const filePath = resolveThemeFilePath(themeId, source as DesktopThemePackageSource, relativePath);
		if (!existsSync(filePath)) return new Response("Not found", { status: 404 });
		return new Response(await readFile(filePath), {
			headers: {
				"content-type": contentType(filePath),
				"access-control-allow-origin": "*",
				"cache-control": "public, max-age=31536000, immutable",
			},
		});
	});
}
