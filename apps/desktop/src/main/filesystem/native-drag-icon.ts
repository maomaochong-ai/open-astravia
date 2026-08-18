import { type NativeImage, nativeImage } from "electron";
import { iconPath } from "../window-manager.js";

const DRAG_ICON_SIZE = 32;
const MAX_CACHE_ENTRIES = 256;
/** Cap PNG data URL length (~256KB decoded is plenty for a 32px icon). */
const MAX_DATA_URL_CHARS = 400_000;

/** Path → resized drag ghost. Filled by renderer (app file-type icons), not OS icons. */
const iconCache = new Map<string, NativeImage>();

function resizeToDragIcon(image: NativeImage): NativeImage {
	if (image.isEmpty()) return image;
	const { width, height } = image.getSize();
	if (width === DRAG_ICON_SIZE && height === DRAG_ICON_SIZE) return image;
	return image.resize({ width: DRAG_ICON_SIZE, height: DRAG_ICON_SIZE, quality: "best" });
}

function remember(path: string, image: NativeImage): void {
	if (image.isEmpty()) return;
	if (iconCache.size >= MAX_CACHE_ENTRIES) {
		const oldest = iconCache.keys().next().value;
		if (oldest !== undefined) iconCache.delete(oldest);
	}
	iconCache.set(path, image);
}

/**
 * App-branded fallback when the renderer has not cached a type icon yet.
 * Prefer PNG (`iconPath.linux`) — .icns/.ico resize is less reliable for a 32px ghost.
 */
export function createFallbackAppDragIcon(): NativeImage {
	const candidates = [iconPath.linux, iconPath[process.platform], iconPath.win32, iconPath.darwin].filter(
		(p): p is string => typeof p === "string" && p.length > 0,
	);
	for (const candidate of new Set(candidates)) {
		const image = resizeToDragIcon(nativeImage.createFromPath(candidate));
		if (!image.isEmpty()) return image;
	}
	throw new Error("Native drag icon could not be loaded");
}

/**
 * Store a renderer-rasterized app file-type icon (PNG data URL) for a path.
 * Used so startDrag can stay synchronous while matching the file tree icons.
 */
export function cacheNativeDragIconFromDataUrl(filePath: string, pngDataUrl: string): boolean {
	if (!filePath || typeof pngDataUrl !== "string") return false;
	if (!pngDataUrl.startsWith("data:image/png")) return false;
	if (pngDataUrl.length > MAX_DATA_URL_CHARS) return false;
	try {
		const image = resizeToDragIcon(nativeImage.createFromDataURL(pngDataUrl));
		if (image.isEmpty()) return false;
		remember(filePath, image);
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolve the ghost icon for startDrag synchronously.
 * Prefers a renderer-cached app file-type icon; otherwise the app logo.
 */
export function resolveNativeDragIcon(paths: readonly string[]): NativeImage {
	const primary = paths[0];
	if (!primary) return createFallbackAppDragIcon();

	const cached = iconCache.get(primary);
	if (cached && !cached.isEmpty()) return cached;

	return createFallbackAppDragIcon();
}

/** Test helper — clears path cache between cases. */
export function clearNativeDragIconCacheForTests(): void {
	iconCache.clear();
}
