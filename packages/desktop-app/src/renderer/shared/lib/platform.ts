/** Platform detection utilities */

export const isMac = navigator.platform.toUpperCase().includes("MAC");
export const isWindows = navigator.platform.toUpperCase().includes("WIN");

/** 把平台写到 `<html data-platform>`，供仅在某个平台生效的样式（如 macOS 原生毛玻璃）选择。 */
export function applyPlatformAttribute(): void {
	document.documentElement.dataset.platform = isMac ? "mac" : isWindows ? "windows" : "linux";
}

/** Display-friendly modifier key name */
export const modKey = isMac ? "⌘" : "Ctrl";
export const altKey = isMac ? "⌥" : "Alt";
export const shiftKey = "⇧";

/**
 * Convert a KeyboardEvent into a serialized shortcut string.
 * Format: "mod+shift+alt+key" (lowercase, sorted modifiers)
 *
 * "mod" = Meta on Mac, Control on Windows/Linux.
 */
export function eventToShortcut(e: KeyboardEvent): string | null {
	const key = e.key;
	// Ignore bare modifier presses
	if (["Control", "Meta", "Alt", "Shift"].includes(key)) return null;

	const parts: string[] = [];
	const mod = isMac ? e.metaKey : e.ctrlKey;
	if (mod) parts.push("mod");
	if (e.shiftKey) parts.push("shift");
	if (isMac ? e.ctrlKey : false) parts.push("ctrl");
	if (e.altKey) parts.push("alt");
	parts.push(key.toLowerCase());

	return parts.join("+");
}

/**
 * Check if a KeyboardEvent matches a serialized shortcut string.
 */
export function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
	const recorded = eventToShortcut(e);
	return recorded === shortcut;
}

/**
 * Format a shortcut string for display.
 * "mod+shift+n" → "⌘ ⇧ N" (Mac) or "Ctrl ⇧ N" (Windows)
 */
export function formatShortcut(shortcut: string): string {
	const parts = shortcut.split("+");
	const display: string[] = [];

	for (const part of parts) {
		switch (part) {
			case "mod":
				display.push(modKey);
				break;
			case "shift":
				display.push(shiftKey);
				break;
			case "alt":
				display.push(altKey);
				break;
			case "ctrl":
				display.push("Ctrl");
				break;
			default:
				display.push(part.toUpperCase());
				break;
		}
	}

	return display.join(" ");
}

/**
 * Format shortcut into individual key parts for rendering as key caps.
 */
export function shortcutParts(shortcut: string): string[] {
	const parts = shortcut.split("+");
	return parts.map((part) => {
		switch (part) {
			case "mod":
				return modKey;
			case "shift":
				return shiftKey;
			case "alt":
				return altKey;
			case "ctrl":
				return "Ctrl";
			default:
				return part.toUpperCase();
		}
	});
}
