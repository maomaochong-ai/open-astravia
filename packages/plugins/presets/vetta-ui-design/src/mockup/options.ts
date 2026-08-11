import type { MockupOptions } from "./types";

/**
 * Export settings are a local habit, not design content — they live in
 * localStorage per design document rather than in design.json, which
 * the canvas owns and the agent reads.
 */
const STORAGE_PREFIX = "vetta-ui-design:mockup:";

/** Radius scales with the normalized height so phones and desktops both look right. */
export const RADIUS_RATIO = 0.05;

export function defaultOptions(normalizedHeight: number): MockupOptions {
	return {
		radius: Math.round(normalizedHeight * RADIUS_RATIO),
		borderWidth: 12,
		borderColor: "#000000",
		background: "#1C1C1E",
		transparent: false,
		shadow: true,
		brand: true,
		scale: 2,
	};
}

function isOptions(value: unknown): value is MockupOptions {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.radius === "number" &&
		typeof candidate.borderWidth === "number" &&
		typeof candidate.borderColor === "string" &&
		typeof candidate.background === "string" &&
		typeof candidate.transparent === "boolean" &&
		typeof candidate.shadow === "boolean" &&
		typeof candidate.brand === "boolean" &&
		(candidate.scale === 1 || candidate.scale === 2)
	);
}

export function loadOptions(vetdPath: string, normalizedHeight: number): MockupOptions {
	const fallback = defaultOptions(normalizedHeight);
	try {
		const raw = localStorage.getItem(STORAGE_PREFIX + vetdPath);
		if (!raw) return fallback;
		const parsed: unknown = JSON.parse(raw);
		return isOptions(parsed) ? parsed : fallback;
	} catch {
		return fallback;
	}
}

export function saveOptions(vetdPath: string, options: MockupOptions): void {
	try {
		localStorage.setItem(STORAGE_PREFIX + vetdPath, JSON.stringify(options));
	} catch {
		// Storage full / disabled: settings just do not persist.
	}
}
