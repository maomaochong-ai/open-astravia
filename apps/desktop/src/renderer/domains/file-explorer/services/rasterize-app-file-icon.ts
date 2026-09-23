import { getFileIcon } from "@vetta-org/theme-ui/file-explorer";

const DRAG_ICON_SIZE = 32;
/** Cache by iconify class so multi-file drags of the same type stay cheap. */
const classPngCache = new Map<string, string>();
const pendingClassPng = new Map<string, Promise<string | null>>();

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
		const match = /url\(\s*(?:"(data:image\/[^"]+)"|'(data:image\/[^']+)'|(data:image\/[^\s)]+))\s*\)/i.exec(value);
		const url = match?.[1] ?? match?.[2] ?? match?.[3];
		if (url) return url;
	}
	return null;
}

function findIconDataUrl(rules: CSSRuleList, selector: string): string | null {
	for (const rule of rules) {
		if (rule instanceof CSSStyleRule && rule.selectorText === selector) {
			const url = extractIconifyDataUrlFromCssValues([
				rule.style.backgroundImage,
				rule.style.maskImage,
				rule.style.getPropertyValue("--svg"),
			]);
			if (url) return url;
		}
		if (rule instanceof CSSMediaRule && !matchMedia(rule.conditionText).matches) continue;
		if (rule instanceof CSSSupportsRule && !CSS.supports(rule.conditionText)) continue;
		if (rule instanceof CSSGroupingRule) {
			const url = findIconDataUrl(rule.cssRules, selector);
			if (url) return url;
		}
	}
	return null;
}

/** Read the built-in Iconify utility without attaching a probe or forcing style/layout. */
function readIconDataUrl(iconClass: string): string | null {
	const selector = `.${CSS.escape(iconClass)}`;
	for (const sheet of document.styleSheets) {
		if (sheet.disabled || (sheet.media.mediaText && !matchMedia(sheet.media.mediaText).matches)) continue;
		let rules: CSSRuleList;
		try {
			rules = sheet.cssRules;
		} catch {
			// A cross-origin plugin sheet is not readable; built-in icons live in host CSS.
			continue;
		}
		const url = findIconDataUrl(rules, selector);
		if (url) return url;
	}
	return null;
}

/**
 * Rasterize an app file-tree icon class (same as the tree row) to a PNG data URL for Electron startDrag.
 */
export async function rasterizeAppFileIconClass(iconClass: string, size = DRAG_ICON_SIZE): Promise<string | null> {
	const cacheKey = `${iconClass}@${size}`;
	const cached = classPngCache.get(cacheKey);
	if (cached) return cached;
	const pending = pendingClassPng.get(cacheKey);
	if (pending) return pending;

	if (typeof document === "undefined") return null;

	const dataUrl = readIconDataUrl(iconClass);
	if (!dataUrl) return null;
	const conversion = imageUrlToPngDataUrl(dataUrl, size);
	pendingClassPng.set(cacheKey, conversion);
	try {
		const png = await conversion;
		if (png) classPngCache.set(cacheKey, png);
		return png;
	} finally {
		pendingClassPng.delete(cacheKey);
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
