import { PET_ACTIONS, type PetActionId } from "./pet-actions.js";
import { DEFAULT_PET_BUBBLE_STYLE_ID, normalizePetBubbleStyleId, type PetBubbleStyleId } from "./pet-bubbles.js";

export interface PetConfig {
	schemaVersion: typeof PET_CONFIG_SCHEMA_VERSION;
	enabled: boolean;
	autoMode: boolean;
	alwaysOnTop: boolean;
	size: number;
	debugFrame: boolean;
	bubbleStyleId: PetBubbleStyleId;
	videoScale: number;
	videoBaseSizeByAction: PetVideoBaseSizeByAction;
}

export type PetVideoBaseSizeByAction = Record<PetActionId, number>;

export const PET_SIZE_OPTIONS = [
	{ value: 180, label: "小" },
	{ value: 220, label: "中" },
	{ value: 280, label: "大" },
] as const;

export const PET_SIZE_MIN = 80;
export const PET_SIZE_MAX = 600;
export const PET_SIZE_STEP = 20;
export const PET_VIDEO_SIZE_MIN = 40;
export const PET_VIDEO_SIZE_MAX = 600;
export const PET_VIDEO_SIZE_STEP = 10;
export const DEFAULT_PET_VIDEO_SIZE = 220;
export const PET_VIDEO_SCALE_MIN = 0.4;
export const PET_VIDEO_SCALE_MAX = 2.5;
export const PET_VIDEO_SCALE_STEP = 0.01;
export const DEFAULT_PET_VIDEO_SCALE = 1;
export const PET_CONFIG_SCHEMA_VERSION = 4;

export const DEFAULT_PET_CONFIG: PetConfig = {
	schemaVersion: PET_CONFIG_SCHEMA_VERSION,
	enabled: true,
	autoMode: true,
	alwaysOnTop: true,
	size: 220,
	debugFrame: false,
	bubbleStyleId: DEFAULT_PET_BUBBLE_STYLE_ID,
	videoScale: DEFAULT_PET_VIDEO_SCALE,
	videoBaseSizeByAction: createDefaultVideoBaseSizeByAction(),
};

const PET_ACTION_IDS = new Set<string>(PET_ACTIONS.map((action) => action.id));

function createDefaultVideoBaseSizeByAction(): PetVideoBaseSizeByAction {
	const sizes = {} as PetVideoBaseSizeByAction;
	for (const action of PET_ACTIONS) {
		sizes[action.id] = normalizePetVideoSize(action.videoBaseSize);
	}
	return sizes;
}

export function normalizePetSize(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_PET_CONFIG.size;
	const stepped = Math.round(value / PET_SIZE_STEP) * PET_SIZE_STEP;
	return Math.min(Math.max(stepped, PET_SIZE_MIN), PET_SIZE_MAX);
}

export function normalizePetVideoSize(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_PET_VIDEO_SIZE;
	const stepped = Math.round(value / PET_VIDEO_SIZE_STEP) * PET_VIDEO_SIZE_STEP;
	return Math.min(Math.max(stepped, PET_VIDEO_SIZE_MIN), PET_VIDEO_SIZE_MAX);
}

export function normalizePetVideoSizeForWindow(value: unknown, windowSize: number): number {
	const maxSize = Math.max(
		PET_VIDEO_SIZE_MIN,
		Math.floor(normalizePetSize(windowSize) / PET_VIDEO_SIZE_STEP) * PET_VIDEO_SIZE_STEP,
	);
	return Math.min(normalizePetVideoSize(value), maxSize);
}

export function normalizePetVideoScale(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_PET_VIDEO_SCALE;
	const stepped = Math.round(value / PET_VIDEO_SCALE_STEP) * PET_VIDEO_SCALE_STEP;
	return Math.min(Math.max(stepped, PET_VIDEO_SCALE_MIN), PET_VIDEO_SCALE_MAX);
}

export function getPetVideoBaseSize(config: PetConfig, actionId: PetActionId): number {
	return config.videoBaseSizeByAction[actionId] ?? DEFAULT_PET_VIDEO_SIZE;
}

export function getPetScaledVideoSize(config: PetConfig, actionId: PetActionId): number {
	return normalizePetVideoSize(getPetVideoBaseSize(config, actionId) * config.videoScale);
}

export function getPetScaledVideoSizeForWindow(config: PetConfig, actionId: PetActionId, windowSize: number): number {
	return normalizePetVideoSizeForWindow(getPetScaledVideoSize(config, actionId), windowSize);
}

export function getPetVideoScaleForSize(config: PetConfig, actionId: PetActionId, size: number): number {
	const baseSize = getPetVideoBaseSize(config, actionId);
	return normalizePetVideoScale(normalizePetVideoSize(size) / baseSize);
}

function normalizeVideoBaseSizeByAction(value: unknown): PetVideoBaseSizeByAction {
	const sizes = createDefaultVideoBaseSizeByAction();
	if (typeof value !== "object" || value === null) return sizes;

	const rawSizes = value as Record<string, unknown>;
	for (const action of PET_ACTIONS) {
		sizes[action.id] = normalizePetVideoSize(rawSizes[action.id]);
	}
	return sizes;
}

export function isPetActionId(value: unknown): value is PetActionId {
	return typeof value === "string" && PET_ACTION_IDS.has(value);
}

export function normalizePetConfig(value: unknown): PetConfig {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { ...DEFAULT_PET_CONFIG };
	}

	const config = value as Record<string, unknown>;
	return {
		schemaVersion: PET_CONFIG_SCHEMA_VERSION,
		enabled: typeof config.enabled === "boolean" ? config.enabled : DEFAULT_PET_CONFIG.enabled,
		autoMode: typeof config.autoMode === "boolean" ? config.autoMode : DEFAULT_PET_CONFIG.autoMode,
		alwaysOnTop: typeof config.alwaysOnTop === "boolean" ? config.alwaysOnTop : DEFAULT_PET_CONFIG.alwaysOnTop,
		debugFrame: typeof config.debugFrame === "boolean" ? config.debugFrame : DEFAULT_PET_CONFIG.debugFrame,
		size: normalizePetSize(config.size),
		videoScale: normalizePetVideoScale(config.videoScale),
		bubbleStyleId: normalizePetBubbleStyleId(config.bubbleStyleId),
		videoBaseSizeByAction: normalizeVideoBaseSizeByAction(config.videoBaseSizeByAction),
	};
}
