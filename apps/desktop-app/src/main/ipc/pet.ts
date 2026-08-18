import { ipcMain } from "electron";
import type { PetBubbleStyleAsset, PetDecoration } from "../../preload/api-types/pet.js";
import { isPetActionId, type PetConfig } from "../../shared/pet-config.js";
import {
	PET_BEGIN_WINDOW_MOVE_CHANNEL,
	PET_BEGIN_WINDOW_RESIZE_CHANNEL,
	PET_END_WINDOW_MOVE_CHANNEL,
	PET_END_WINDOW_RESIZE_CHANNEL,
	PET_MOVE_WINDOW_BY_CHANNEL,
	PET_RESIZE_BY_WHEEL_CHANNEL,
	PET_RESIZE_VIDEO_BY_WHEEL_CHANNEL,
	PET_SET_CONTENT_SIZE_CHANNEL,
	PET_SET_MOUSE_PASSTHROUGH_CHANNEL,
	PET_SET_VIDEO_BASE_SIZE_CHANNEL,
	PET_SET_VIDEO_HITBOX_CHANNEL,
	PET_SET_WINDOW_SIZE_CHANNEL,
	type PetContentBounds,
	type PetResizeCorner,
	type PetVideoHitbox,
} from "../../shared/pet-ipc.js";
import {
	beginDesktopPetWindowMove,
	beginDesktopPetWindowResize,
	endDesktopPetWindowMove,
	endDesktopPetWindowResize,
	hideDesktopPet,
	listPetBubbleStyleAssets,
	listPetDecorations,
	moveDesktopPetWindow,
	readCurrentPetConfig,
	resizeDesktopPetVideoByWheel,
	resizeDesktopPetWindowByWheel,
	setDesktopPetActionFromUser,
	setDesktopPetContentSize,
	setDesktopPetMousePassthrough,
	setDesktopPetVideoBaseSize,
	setDesktopPetVideoHitbox,
	setDesktopPetWindowSize,
	showDesktopPet,
	updatePetConfig,
} from "../pet/pet-service.js";

const CHANNELS = {
	GET_CONFIG: "vetta:pet:get-config",
	SET_CONFIG: "vetta:pet:set-config",
	SHOW: "vetta:pet:show",
	HIDE: "vetta:pet:hide",
	SET_ACTION: "vetta:pet:set-action",
	GET_DECORATIONS: "vetta:pet:get-decorations",
	GET_BUBBLE_STYLE_ASSETS: "vetta:pet:get-bubble-style-assets",
} as const;

const PET_RESIZE_CORNERS = new Set<PetResizeCorner>(["top-left", "top-right", "bottom-left", "bottom-right"]);

function isPetResizeCorner(value: unknown): value is PetResizeCorner {
	return typeof value === "string" && PET_RESIZE_CORNERS.has(value as PetResizeCorner);
}

function isPetVideoHitbox(value: unknown): value is PetVideoHitbox {
	if (typeof value !== "object" || value === null) return false;
	const hitbox = value as Record<string, unknown>;
	return (
		typeof hitbox.x === "number" &&
		Number.isFinite(hitbox.x) &&
		typeof hitbox.y === "number" &&
		Number.isFinite(hitbox.y) &&
		typeof hitbox.width === "number" &&
		Number.isFinite(hitbox.width) &&
		typeof hitbox.height === "number" &&
		Number.isFinite(hitbox.height)
	);
}

function isFiniteRect(value: unknown): value is { x: number; y: number; width: number; height: number } {
	if (typeof value !== "object" || value === null) return false;
	const rect = value as Record<string, unknown>;
	return (
		typeof rect.x === "number" &&
		Number.isFinite(rect.x) &&
		typeof rect.y === "number" &&
		Number.isFinite(rect.y) &&
		typeof rect.width === "number" &&
		Number.isFinite(rect.width) &&
		typeof rect.height === "number" &&
		Number.isFinite(rect.height)
	);
}

function isPetContentBounds(value: unknown): value is PetContentBounds {
	if (typeof value !== "object" || value === null) return false;
	const content = value as Record<string, unknown>;
	return isFiniteRect(content.bounds) && isFiniteRect(content.anchor);
}

export function registerPetIpc(): () => void {
	ipcMain.handle(CHANNELS.GET_CONFIG, async (): Promise<PetConfig> => {
		return readCurrentPetConfig();
	});

	ipcMain.handle(CHANNELS.SET_CONFIG, async (_event, patch: unknown): Promise<PetConfig> => {
		if (typeof patch !== "object" || patch === null) {
			throw new Error("Invalid pet config");
		}
		return updatePetConfig(patch as Partial<PetConfig>);
	});

	ipcMain.handle(CHANNELS.SHOW, async (): Promise<PetConfig> => {
		return showDesktopPet();
	});

	ipcMain.handle(CHANNELS.HIDE, async (): Promise<PetConfig> => {
		return hideDesktopPet();
	});

	ipcMain.handle(CHANNELS.SET_ACTION, (_event, actionId: unknown): void => {
		if (!isPetActionId(actionId)) return;
		setDesktopPetActionFromUser(actionId);
	});

	ipcMain.handle(CHANNELS.GET_DECORATIONS, (): PetDecoration[] => {
		return listPetDecorations();
	});

	ipcMain.handle(CHANNELS.GET_BUBBLE_STYLE_ASSETS, (): PetBubbleStyleAsset[] => {
		return listPetBubbleStyleAssets();
	});

	ipcMain.handle(PET_RESIZE_BY_WHEEL_CHANNEL, async (_event, deltaY: unknown): Promise<void> => {
		if (typeof deltaY !== "number") return;
		await resizeDesktopPetWindowByWheel(deltaY);
	});

	ipcMain.handle(
		PET_RESIZE_VIDEO_BY_WHEEL_CHANNEL,
		async (_event, actionId: unknown, deltaY: unknown): Promise<void> => {
			if (!isPetActionId(actionId) || typeof deltaY !== "number") return;
			await resizeDesktopPetVideoByWheel(actionId, deltaY);
		},
	);

	ipcMain.handle(PET_BEGIN_WINDOW_MOVE_CHANNEL, (): void => {
		beginDesktopPetWindowMove();
	});

	ipcMain.handle(PET_MOVE_WINDOW_BY_CHANNEL, (): void => {
		moveDesktopPetWindow();
	});

	ipcMain.handle(PET_END_WINDOW_MOVE_CHANNEL, (): void => {
		endDesktopPetWindowMove();
	});

	ipcMain.handle(PET_BEGIN_WINDOW_RESIZE_CHANNEL, (_event, corner: unknown): void => {
		if (!isPetResizeCorner(corner)) return;
		beginDesktopPetWindowResize(corner);
	});

	ipcMain.handle(PET_SET_WINDOW_SIZE_CHANNEL, async (_event, size: unknown, corner: unknown): Promise<void> => {
		if (typeof size !== "number") return;
		await setDesktopPetWindowSize(size, isPetResizeCorner(corner) ? corner : undefined);
	});

	ipcMain.handle(PET_SET_CONTENT_SIZE_CHANNEL, (_event, content: unknown): void => {
		if (typeof content !== "number" && !isPetContentBounds(content)) return;
		setDesktopPetContentSize(content);
	});

	ipcMain.handle(PET_END_WINDOW_RESIZE_CHANNEL, async (_event, size: unknown): Promise<void> => {
		if (typeof size !== "number") return;
		await endDesktopPetWindowResize(size);
	});

	ipcMain.handle(
		PET_SET_VIDEO_BASE_SIZE_CHANNEL,
		async (_event, actionId: unknown, baseSize: unknown): Promise<void> => {
			if (!isPetActionId(actionId) || typeof baseSize !== "number") return;
			await setDesktopPetVideoBaseSize(actionId, baseSize);
		},
	);

	ipcMain.handle(PET_SET_MOUSE_PASSTHROUGH_CHANNEL, (_event, enabled: unknown): void => {
		if (typeof enabled !== "boolean") return;
		setDesktopPetMousePassthrough(enabled);
	});

	ipcMain.handle(PET_SET_VIDEO_HITBOX_CHANNEL, (_event, hitbox: unknown): void => {
		setDesktopPetVideoHitbox(isPetVideoHitbox(hitbox) ? hitbox : undefined);
	});

	return () => {
		ipcMain.removeHandler(CHANNELS.GET_CONFIG);
		ipcMain.removeHandler(CHANNELS.SET_CONFIG);
		ipcMain.removeHandler(CHANNELS.SHOW);
		ipcMain.removeHandler(CHANNELS.HIDE);
		ipcMain.removeHandler(CHANNELS.SET_ACTION);
		ipcMain.removeHandler(CHANNELS.GET_DECORATIONS);
		ipcMain.removeHandler(CHANNELS.GET_BUBBLE_STYLE_ASSETS);
		ipcMain.removeHandler(PET_RESIZE_BY_WHEEL_CHANNEL);
		ipcMain.removeHandler(PET_RESIZE_VIDEO_BY_WHEEL_CHANNEL);
		ipcMain.removeHandler(PET_BEGIN_WINDOW_MOVE_CHANNEL);
		ipcMain.removeHandler(PET_MOVE_WINDOW_BY_CHANNEL);
		ipcMain.removeHandler(PET_END_WINDOW_MOVE_CHANNEL);
		ipcMain.removeHandler(PET_BEGIN_WINDOW_RESIZE_CHANNEL);
		ipcMain.removeHandler(PET_SET_WINDOW_SIZE_CHANNEL);
		ipcMain.removeHandler(PET_SET_CONTENT_SIZE_CHANNEL);
		ipcMain.removeHandler(PET_END_WINDOW_RESIZE_CHANNEL);
		ipcMain.removeHandler(PET_SET_VIDEO_BASE_SIZE_CHANNEL);
		ipcMain.removeHandler(PET_SET_MOUSE_PASSTHROUGH_CHANNEL);
		ipcMain.removeHandler(PET_SET_VIDEO_HITBOX_CHANNEL);
	};
}
