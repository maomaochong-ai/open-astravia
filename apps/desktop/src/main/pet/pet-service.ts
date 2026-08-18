import type { PetBubbleStyleAsset, PetDecoration } from "../../preload/api-types/pet.js";
import type { PetActionId } from "../../shared/pet-actions.js";
import { normalizePetConfig, type PetConfig } from "../../shared/pet-config.js";
import type { PetContentBounds, PetResizeCorner, PetVideoHitbox } from "../../shared/pet-ipc.js";
import { readPetConfig, writePetConfig } from "../pet-config-store.js";
import {
	applyPetConfig,
	beginPetWindowMove,
	beginPetWindowResize,
	endPetWindowMove,
	endPetWindowResize,
	movePetWindow,
	resizePetVideoByWheel,
	resizePetWindowByWheel,
	sendPetCommandToWindow,
	setPetMousePassthrough,
	setPetVideoBaseSize,
	setPetVideoHitbox,
	setPetWindowContentSize,
	setPetWindowSize,
	showPetWindow,
} from "../pet-window.js";
import { getPetBubbleStyleAssets } from "./pet-bubble-style-assets.js";
import { getPetDecorations } from "./pet-decorations.js";

const USER_ACTION_HOLD_MS = 10_000;

async function persistPetConfig(patch: Partial<PetConfig>): Promise<PetConfig> {
	const current = await readPetConfig();
	const nextPet = normalizePetConfig({ ...current, ...patch });
	await writePetConfig(nextPet);
	applyPetConfig(nextPet);
	return nextPet;
}

export async function readCurrentPetConfig(): Promise<PetConfig> {
	return readPetConfig();
}

export async function updatePetConfig(patch: Partial<PetConfig>): Promise<PetConfig> {
	return persistPetConfig(patch);
}

export async function showDesktopPet(): Promise<PetConfig> {
	const next = await persistPetConfig({ enabled: true });
	showPetWindow();
	return next;
}

export async function hideDesktopPet(): Promise<PetConfig> {
	return persistPetConfig({ enabled: false });
}

export function setDesktopPetActionFromUser(actionId: PetActionId): void {
	sendPetCommandToWindow({ type: "set-action", actionId, source: "user", holdMs: USER_ACTION_HOLD_MS });
}

export function listPetDecorations(): PetDecoration[] {
	return getPetDecorations();
}

export function listPetBubbleStyleAssets(): PetBubbleStyleAsset[] {
	return getPetBubbleStyleAssets();
}

export async function resizeDesktopPetWindowByWheel(deltaY: number): Promise<void> {
	await resizePetWindowByWheel(deltaY);
}

export async function resizeDesktopPetVideoByWheel(actionId: PetActionId, deltaY: number): Promise<void> {
	await resizePetVideoByWheel(actionId, deltaY);
}

export function beginDesktopPetWindowMove(): void {
	beginPetWindowMove();
}

export function moveDesktopPetWindow(): void {
	movePetWindow();
}

export function endDesktopPetWindowMove(): void {
	endPetWindowMove();
}

export function beginDesktopPetWindowResize(corner: PetResizeCorner): void {
	beginPetWindowResize(corner);
}

export async function setDesktopPetWindowSize(size: number, corner?: PetResizeCorner): Promise<void> {
	await setPetWindowSize(size, corner);
}

export function setDesktopPetContentSize(content: number | PetContentBounds): void {
	setPetWindowContentSize(content);
}

export async function endDesktopPetWindowResize(size: number): Promise<void> {
	await endPetWindowResize(size);
}

export async function setDesktopPetVideoBaseSize(actionId: PetActionId, baseSize: number): Promise<void> {
	await setPetVideoBaseSize(actionId, baseSize);
}

export function setDesktopPetMousePassthrough(enabled: boolean): void {
	setPetMousePassthrough(enabled);
}

export function setDesktopPetVideoHitbox(hitbox: PetVideoHitbox | undefined): void {
	setPetVideoHitbox(hitbox);
}
