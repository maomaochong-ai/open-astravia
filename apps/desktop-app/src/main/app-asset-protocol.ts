import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { app, type CustomScheme, protocol } from "electron";
import { APP_ASSET_PROTOCOL_SCHEME, type AppAssetScope, isAppAssetScope } from "../shared/app-asset-protocol.js";

const CONTENT_TYPES: Record<string, string> = {
	avif: "image/avif",
	css: "text/css; charset=utf-8",
	gif: "image/gif",
	ico: "image/x-icon",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	js: "text/javascript; charset=utf-8",
	json: "application/json; charset=utf-8",
	mjs: "text/javascript; charset=utf-8",
	otf: "font/otf",
	png: "image/png",
	svg: "image/svg+xml",
	ttf: "font/ttf",
	wasm: "application/wasm",
	webp: "image/webp",
	woff: "font/woff",
	woff2: "font/woff2",
};

function rendererAssetRoot(): string {
	return app.isPackaged ? join(app.getAppPath(), "renderer") : join(process.cwd(), "src", "renderer", "public");
}

const ASSET_ROOTS = {
	renderer: rendererAssetRoot,
} satisfies Record<AppAssetScope, () => string>;

function resolveAssetPath(scope: AppAssetScope, relativePath: string): string {
	const root = resolve(ASSET_ROOTS[scope]());
	const target = resolve(root, relativePath);
	if (target === root || !target.startsWith(`${root}${sep}`)) {
		throw new Error("App asset path escapes its scope");
	}
	return target;
}

function contentType(filePath: string): string {
	return CONTENT_TYPES[extname(filePath).slice(1).toLowerCase()] ?? "application/octet-stream";
}

export const APP_ASSET_PROTOCOL_PRIVILEGE: CustomScheme = {
	scheme: APP_ASSET_PROTOCOL_SCHEME,
	privileges: {
		standard: true,
		secure: true,
		supportFetchAPI: true,
		corsEnabled: true,
	},
};

export function registerAppAssetProtocol(): void {
	protocol.handle(APP_ASSET_PROTOCOL_SCHEME, async (request) => {
		let filePath: string;
		try {
			const url = new URL(request.url);
			if (!isAppAssetScope(url.hostname)) return new Response("Unknown asset scope", { status: 404 });
			const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
			filePath = resolveAssetPath(url.hostname, relativePath);
		} catch {
			return new Response("Invalid asset path", { status: 400 });
		}

		try {
			const fileStat = await stat(filePath);
			if (!fileStat.isFile()) return new Response("Not found", { status: 404 });
			return new Response(await readFile(filePath), {
				headers: {
					"content-type": contentType(filePath),
					"access-control-allow-origin": "*",
					"cache-control": "no-store",
				},
			});
		} catch {
			return new Response("Not found", { status: 404 });
		}
	});
}
