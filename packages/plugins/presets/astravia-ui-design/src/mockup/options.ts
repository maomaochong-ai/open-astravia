import { type FramesPerPage, FRAMES_PER_PAGE, type MockupOptions } from "./types";

/**
 * Export settings are a local habit, not design content — they live in
 * localStorage per design document rather than in design.json, which
 * the canvas owns and the agent reads.
 */
const STORAGE_PREFIX = "astravia-ui-design:mockup:";

/** Radius scales with the normalized height so phones and desktops both look right. */
export const RADIUS_RATIO = 0.05;

/** 默认每页三个画框：手机稿三连是最常用的一张图，再多就开始压字号。 */
const DEFAULT_PER_PAGE: FramesPerPage = 3;

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
		perPage: DEFAULT_PER_PAGE,
	};
}

/**
 * 逐字段接受已存设置。
 *
 * 整体校验（少一个字段就整份丢弃）在加字段时会静默清空用户的全部偏好——
 * `perPage` 就是新加的那个字段。这里按字段回退，只丢真正不合法的部分。
 */
export function normalizeOptions(raw: unknown, fallback: MockupOptions): MockupOptions {
	if (typeof raw !== "object" || raw === null) return fallback;
	const value = raw as Record<string, unknown>;
	const num = (key: keyof MockupOptions, min: number): number => {
		const candidate = value[key];
		return typeof candidate === "number" && Number.isFinite(candidate) && candidate >= min
			? candidate
			: (fallback[key] as number);
	};
	const str = (key: keyof MockupOptions): string => {
		const candidate = value[key];
		return typeof candidate === "string" && candidate.trim() !== "" ? candidate : (fallback[key] as string);
	};
	const bool = (key: keyof MockupOptions): boolean => {
		const candidate = value[key];
		return typeof candidate === "boolean" ? candidate : (fallback[key] as boolean);
	};
	return {
		radius: num("radius", 0),
		borderWidth: num("borderWidth", 0),
		borderColor: str("borderColor"),
		background: str("background"),
		transparent: bool("transparent"),
		shadow: bool("shadow"),
		brand: bool("brand"),
		scale: value.scale === 1 || value.scale === 2 ? value.scale : fallback.scale,
		perPage: FRAMES_PER_PAGE.includes(value.perPage as FramesPerPage)
			? (value.perPage as FramesPerPage)
			: fallback.perPage,
	};
}

export function loadOptions(astdPath: string, normalizedHeight: number): MockupOptions {
	const fallback = defaultOptions(normalizedHeight);
	try {
		const raw = localStorage.getItem(STORAGE_PREFIX + astdPath);
		if (!raw) return fallback;
		return normalizeOptions(JSON.parse(raw), fallback);
	} catch {
		return fallback;
	}
}

export function saveOptions(astdPath: string, options: MockupOptions): void {
	try {
		localStorage.setItem(STORAGE_PREFIX + astdPath, JSON.stringify(options));
	} catch {
		// Storage full / disabled: settings just do not persist.
	}
}
