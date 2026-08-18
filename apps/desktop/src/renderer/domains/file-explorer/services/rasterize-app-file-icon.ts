import { getFileIcon } from "@vetta/theme-ui/file-explorer";

const DRAG_ICON_SIZE = 32;
/** Cache by iconify class so multi-file drags of the same type stay cheap. */
const classPngCache = new Map<string, string>();

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("Failed to load drag icon image"));
		image.src = src;
	});
}

async function imageUrlToPngDataUrl(src: string, size: number): Promise<string | null> {
	try {
		const image = await loadImage(src);
		const canvas = document.createElement("canvas");
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		ctx.clearRect(0, 0, size, size);
		ctx.drawImage(image, 0, 0, size, size);
		const png = canvas.toDataURL("image/png");
		return png.startsWith("data:image/png") ? png : null;
	} catch {
		return null;
	}
}

/** Pull first `data:image/...` URL from CSS image values (background / mask). */
export function extractIconifyDataUrlFromCssValues(values: readonly string[]): string | null {
	for (const value of values) {
		if (!value || value === "none") continue;
		const match = /url\(\s*(['"]?)(data:image\/[^)'"]+)\1\s*\)/i.exec(value);
		if (match?.[2]) return match[2];
	}
	return null;
}

/**
 * Pull the SVG/data URL already embedded by @iconify/tailwind4 for a tree icon class.
 * Avoids bundling the full vscode-icons JSON (~3.6MB).
 */
export function extractIconifyDataUrlFromElement(el: HTMLElement): string | null {
	const styles = [getComputedStyle(el), getComputedStyle(el, "::before"), getComputedStyle(el, "::after")];
	const candidates: string[] = [];
	for (const style of styles) {
		candidates.push(
			style.backgroundImage,
			style.maskImage,
			// WebKit prefix still used in Chromium for mask in some paths
			style.getPropertyValue("-webkit-mask-image"),
			style.getPropertyValue("mask-image"),
			style.getPropertyValue("background-image"),
		);
	}
	return extractIconifyDataUrlFromCssValues(candidates);
}

/**
 * Rasterize an app file-tree icon class (same as the tree row) to a PNG data URL for Electron startDrag.
 */
export async function rasterizeAppFileIconClass(iconClass: string, size = DRAG_ICON_SIZE): Promise<string | null> {
	const cacheKey = `${iconClass}@${size}`;
	const cached = classPngCache.get(cacheKey);
	if (cached) return cached;

	if (typeof document === "undefined") return null;

	const host = document.createElement("span");
	host.className = iconClass;
	host.setAttribute("aria-hidden", "true");
	host.style.cssText = [
		"position:fixed",
		"left:-10000px",
		"top:0",
		`width:${size}px`,
		`height:${size}px`,
		"display:inline-block",
		"box-sizing:border-box",
		"line-height:0",
		"overflow:hidden",
		// Match tree default: colored vscode-icons use background; monochrome use currentColor mask
		"color:rgb(120,120,120)",
	].join(";");
	document.documentElement.appendChild(host);

	try {
		// Let the stylesheet apply to the offscreen node.
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
		});

		const dataUrl = extractIconifyDataUrlFromElement(host);
		if (!dataUrl) return null;

		const png = await imageUrlToPngDataUrl(dataUrl, size);
		if (!png) return null;
		classPngCache.set(cacheKey, png);
		return png;
	} finally {
		host.remove();
	}
}

export interface AppFileDragIconEntry {
	path: string;
	name: string;
	isDirectory: boolean;
}

/**
 * Resolve tree icons for entries, rasterize, and cache them in the main process for native drag.
 */
export async function cacheAppFileDragIcons(
	entries: readonly AppFileDragIconEntry[],
	cacheDragIcon: (path: string, pngDataUrl: string) => void = (path, png) => window.vetta.fs.cacheDragIcon(path, png),
): Promise<void> {
	const seen = new Set<string>();
	for (const entry of entries) {
		if (!entry.path || seen.has(entry.path)) continue;
		seen.add(entry.path);
		const iconClass = getFileIcon(entry.name, entry.isDirectory, false);
		const png = await rasterizeAppFileIconClass(iconClass);
		if (png) cacheDragIcon(entry.path, png);
	}
}
