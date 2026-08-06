import { readFile } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import type { Plugin } from "vite";

export const HOST_THEME_STYLESHEET_ID = "@vetta-org/plugin-sdk/tailwind-theme.css";

const HOST_THEME_IMPORT = `@import "${HOST_THEME_STYLESHEET_ID}";`;
const HOST_THEME_IMPORT_PATTERN = /@import\s+["']@vetta-org\/plugin-sdk\/tailwind-theme\.css["']\s*;/u;
const TAILWIND_IMPORT_PATTERN = /@import\s+["']tailwindcss(?:\/(?:theme|utilities)\.css)?["'](?:\s+layer\([^)]*\))?\s*;/u;

export function injectHostThemeBridge(css: string): string | undefined {
	if (HOST_THEME_IMPORT_PATTERN.test(css)) return;
	const tailwindImport = TAILWIND_IMPORT_PATTERN.exec(css);
	if (!tailwindImport || tailwindImport.index === undefined) return;
	const insertionIndex = tailwindImport.index + tailwindImport[0].length;
	return `${css.slice(0, insertionIndex)}\n${HOST_THEME_IMPORT}${css.slice(insertionIndex)}`;
}

export function createHostThemeBridgePlugin(): Plugin {
	let rootDir = "";
	return {
		name: "vetta-plugin-host-theme",
		enforce: "pre",
		configResolved(config) {
			rootDir = config.root;
		},
		async load(id) {
			if (id.includes("?") || id.includes("\0") || !id.endsWith(".css") || !isInsideRoot(id, rootDir)) {
				return;
			}
			const css = await readFile(id, "utf8").catch(() => null);
			if (css === null) return;
			const injected = injectHostThemeBridge(css);
			return injected ? { code: injected, map: null } : undefined;
		},
	};
}

function isInsideRoot(filePath: string, rootDir: string): boolean {
	if (!rootDir || !isAbsolute(filePath)) return false;
	const relativePath = relative(rootDir, filePath);
	return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}
